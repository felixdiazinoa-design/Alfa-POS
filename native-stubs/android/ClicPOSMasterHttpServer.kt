package com.clicpos.nativeprinter

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Collections
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

object ClicPOSMasterHttpServer {
    private const val DEFAULT_PORT = 3001
    private const val PREFS_NAME = "clic_pos_master_bindings"
    private const val PREFS_BINDINGS_KEY = "terminal_device_bindings"
    private const val PREFS_RESTAURANT_KEY = "restaurant_state"
    private const val TABLE_EDIT_LOCK_TTL_MS = 45_000L
    private const val AUDIT_CLAIM_TTL_MS = 15 * 60 * 1000L
    private val running = AtomicBoolean(false)
    private val executor = Executors.newCachedThreadPool()
    private var serverSocket: ServerSocket? = null
    private var activePort = DEFAULT_PORT
    @Volatile private var appContext: Context? = null
    @Volatile private var configSnapshot = JSONObject()
    @Volatile private var usersSnapshot = JSONArray()
    @Volatile private var roomsSnapshot = JSONArray()
    @Volatile private var tablesSnapshot = JSONArray()
    @Volatile private var parkedTicketsSnapshot = JSONArray()
    @Volatile private var catalogSnapshots = JSONObject()
    private val restaurantRevision = AtomicLong(0)
    private val syncTokens = ConcurrentHashMap<String, String>()
    private val catalogVersions = ConcurrentHashMap<String, Long>()
    private val productRoutingOverrides = ConcurrentHashMap<String, JSONObject>()
    private val tableEditLocks = ConcurrentHashMap<String, JSONObject>()
    private val auditSessions = ConcurrentHashMap<String, JSONObject>()
    @Volatile private var restaurantStateLoaded = false

    fun start(
        context: Context,
        requestedPort: Int = DEFAULT_PORT,
        config: JSONObject? = null,
        users: JSONArray? = null,
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null,
        catalogs: JSONObject? = null,
        acknowledgedRestaurantRevision: Long = 0
    ): JSONObject {
        appContext = context.applicationContext
        restoreRestaurantSnapshot()
        config?.let { configSnapshot = applyPersistedBindings(JSONObject(it.toString())) }
        users?.let { usersSnapshot = JSONArray(it.toString()) }
        catalogs?.let { updateCatalogSnapshots(it, acknowledgedRestaurantRevision) }
        updateRestaurantSnapshotFromWebView(
            rooms,
            tables,
            parkedTickets,
            acknowledgedRestaurantRevision
        )
        activePort = requestedPort.takeIf { it in 1..65535 } ?: DEFAULT_PORT

        if (running.get()) {
            ClicPOSMasterDiscovery.advertise(context, activePort, configSnapshot)
            return status(context)
        }

        return try {
            val socket = ServerSocket(activePort)
            socket.reuseAddress = true
            serverSocket = socket
            running.set(true)
            ClicPOSMasterDiscovery.advertise(context, activePort, configSnapshot)

            executor.execute {
                while (running.get()) {
                    try {
                        val client = socket.accept()
                        executor.execute { handleClient(client) }
                    } catch (_: Exception) {
                        if (running.get()) running.set(false)
                    }
                }
            }

            status(context)
        } catch (error: Exception) {
            running.set(false)
            JSONObject()
                .put("status", "error")
                .put("success", false)
                .put("running", false)
                .put("port", activePort)
                .put("message", error.message ?: "No se pudo iniciar el servidor Master")
        }
    }

    fun updateConfig(
        config: JSONObject,
        users: JSONArray? = null,
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null,
        catalogs: JSONObject? = null,
        acknowledgedRestaurantRevision: Long = 0
    ): JSONObject {
        configSnapshot = applyPersistedBindings(JSONObject(config.toString()))
        users?.let { usersSnapshot = JSONArray(it.toString()) }
        catalogs?.let { updateCatalogSnapshots(it, acknowledgedRestaurantRevision) }
        updateRestaurantSnapshotFromWebView(
            rooms,
            tables,
            parkedTickets,
            acknowledgedRestaurantRevision
        )
        appContext?.let { context ->
            if (running.get()) ClicPOSMasterDiscovery.advertise(context, activePort, configSnapshot)
        }
        return JSONObject()
            .put("status", "success")
            .put("success", true)
            .put("running", running.get())
            .put("port", activePort)
    }

    fun stop(): JSONObject {
        running.set(false)
        runCatching { serverSocket?.close() }
        serverSocket = null
        appContext?.let { ClicPOSMasterDiscovery.stopAdvertising(it) }
        return JSONObject()
            .put("status", "stopped")
            .put("success", true)
            .put("running", false)
            .put("port", activePort)
    }

    fun status(context: Context): JSONObject {
        val ips = localIpv4Addresses()
        val localIp = ips.firstOrNull()
        return JSONObject()
            .put("status", if (running.get()) "running" else "stopped")
            .put("success", running.get())
            .put("running", running.get())
            .put("port", activePort)
            .put("localIp", localIp)
            .put("localIps", JSONArray(ips))
            .put("url", if (localIp != null) "http://$localIp:$activePort" else JSONObject.NULL)
            .put("packageName", context.packageName)
    }

    private fun handleClient(socket: Socket) {
        socket.use { client ->
            try {
                client.soTimeout = 5000
                val input = client.getInputStream()
                val requestLine = readAsciiLine(input)
                if (requestLine.isBlank()) return

                val parts = requestLine.split(" ")
                val method = parts.getOrNull(0)?.uppercase() ?: "GET"
                val path = (parts.getOrNull(1) ?: "/").substringBefore("?")
                var contentLength = 0
                val headers = mutableMapOf<String, String>()

                while (true) {
                    val line = readAsciiLine(input)
                    if (line.isBlank()) break
                    val separator = line.indexOf(':')
                    if (separator > 0) {
                        val headerName = line.substring(0, separator).trim().lowercase()
                        val headerValue = line.substring(separator + 1).trim()
                        headers[headerName] = headerValue
                        if (headerName == "content-length") {
                            contentLength = headerValue.toIntOrNull() ?: 0
                        }
                    }
                }

                val body = if (contentLength > 0) {
                    val buffer = ByteArray(contentLength)
                    var offset = 0
                    while (offset < contentLength) {
                        val read = input.read(buffer, offset, contentLength - offset)
                        if (read <= 0) break
                        offset += read
                    }
                    String(buffer, 0, offset, StandardCharsets.UTF_8)
                } else {
                    ""
                }

                when {
                    method == "OPTIONS" -> writeResponse(client, 204, "")
                    method == "GET" && (path == "/api/sync/identify" || path == "/api/network/identify") ->
                        writeResponse(client, 200, ClicPOSMasterDiscovery.identity(configSnapshot, activePort).toString())
                    method == "GET" && (path == "/api/sync/ping" || path == "/api/health") ->
                        writeResponse(client, 200, JSONObject()
                            .put("success", true)
                            .put("status", "ONLINE")
                            .put("runtime", "ANDROID_MASTER")
                            .toString())
                    method == "POST" && path == "/api/sync/auth" ->
                        handleSyncAuth(client, body)
                    method == "GET" && path == "/api/sync/config" ->
                        handleSyncConfig(client, headers)
                    method == "GET" && path.startsWith("/api/sync/collections/") && path.endsWith("/metadata") ->
                        handleSyncCollectionMetadata(client, path, headers)
                    method == "GET" && path.startsWith("/api/sync/collections/") && path.endsWith("/data") ->
                        handleSyncCollectionData(client, path, parts.getOrNull(1) ?: path, headers)
                    method == "POST" && path == "/api/sync/collections/products/push" ->
                        handleProductRoutingPush(client, body, headers)
                    method == "GET" && path.startsWith("/api/sync/delta/") ->
                        handleSyncCollectionDelta(client, path, parts.getOrNull(1) ?: path, headers)
                    method == "GET" && path == "/api/config" ->
                        writeResponse(client, 200, configSnapshot.toString())
                    method == "GET" && path == "/api/users" ->
                        writeResponse(client, 200, usersSnapshot.toString())
                    method == "GET" && path.startsWith("/api/audit/active/") ->
                        handleAuditActive(client, path.removePrefix("/api/audit/active/"))
                    method == "POST" && path == "/api/audit/start" ->
                        handleAuditStart(client, body)
                    method == "POST" && path.startsWith("/api/audit/") && path.endsWith("/heartbeat") ->
                        handleAuditHeartbeat(
                            client,
                            path.removePrefix("/api/audit/").removeSuffix("/heartbeat"),
                            body
                        )
                    method == "POST" && path.startsWith("/api/audit/") && path.endsWith("/release") ->
                        handleAuditRelease(
                            client,
                            path.removePrefix("/api/audit/").removeSuffix("/release"),
                            body
                        )
                    method == "GET" && path == "/api/mesas" ->
                        writeResponse(client, 200, buildRestaurantSnapshot().toString())
                    method == "POST" && path == "/api/mesas/bloquear" ->
                        writeLockResponse(client, acquireTableEditLock(parseJsonBody(body)))
                    method == "POST" && path == "/api/mesas/desbloquear" ->
                        writeLockResponse(client, releaseTableEditLock(parseJsonBody(body)))
                    method == "PUT" && path == "/api/mesas/parked-tickets" ->
                        handleParkedTicketsUpdate(client, body)
                    method == "PUT" && path == "/api/mesas/layout" ->
                        handleFloorPlanReplace(client, body)
                    method == "PUT" && path.startsWith("/api/tables/") ->
                        handleTableUpdate(client, path, body)
                    method == "PUT" && path == "/api/customers" ->
                        handleCustomerUpsert(client, body)
                    method == "POST" && path == "/api/mesas/abrir" ->
                        handleOpenTable(client, body)
                    method == "POST" && path == "/api/mesas/unir" ->
                        handleJoinTables(client, body)
                    method == "POST" && path == "/api/mesas/liberar" ->
                        handleReleaseTable(client, body)
                    method == "GET" && path == "/api/setup/terminals" ->
                        writeResponse(client, 200, buildTerminalListResponse(parts.getOrNull(1) ?: path).toString())
                    method == "GET" && path == "/api/setup/claim-terminal" ->
                        handleTerminalClaim(client, parts.getOrNull(1) ?: path)
                    method == "POST" && path == "/api/setup/bind-terminal" ->
                        handleTerminalBinding(client, body)
                    method == "GET" && path.startsWith("/api/setup/initial-config/") ->
                        writeResponse(
                            client,
                            200,
                            buildInitialConfigResponse(
                                URLDecoder.decode(
                                    path.removePrefix("/api/setup/initial-config/"),
                                    StandardCharsets.UTF_8.name()
                                ),
                                parts.getOrNull(1) ?: path
                            ).toString()
                        )
                    method == "PUT" && path == "/api/config" -> {
                        configSnapshot = if (body.isBlank()) JSONObject() else JSONObject(body)
                        writeResponse(client, 200, configSnapshot.toString())
                    }
                    else -> writeResponse(client, 404, JSONObject()
                        .put("success", false)
                        .put("message", "Endpoint no disponible en el Master Android")
                        .toString())
                }
            } catch (error: Exception) {
                writeResponse(client, 500, JSONObject()
                    .put("success", false)
                    .put("message", error.message ?: "Master server error")
                    .toString())
            }
        }
    }

    private fun buildTerminalListResponse(rawTarget: String): JSONObject {
        val query = parseQuery(rawTarget)
        val deviceId = query.optString("pos_device_id")
        val tenantId = query.optString("tenant_id").ifBlank { "default-tenant" }
        val terminals = configSnapshot.optJSONArray("terminals") ?: JSONArray()
        val result = JSONArray()

        for (index in 0 until terminals.length()) {
            val terminal = terminals.optJSONObject(index) ?: continue
            val terminalId = terminal.optString("id").trim()
            if (terminalId.isBlank()) continue

            val terminalConfig = terminal.optJSONObject("config") ?: JSONObject()
            val currentDeviceId = terminalConfig.optString("currentDeviceId").trim()
            val erpTerminalId = firstNonBlank(
                terminal.optString("erpTerminalId"),
                terminalConfig.optString("erpTerminalId"),
                terminalConfig.optString("erp_terminal_id"),
                terminalId
            )
            val terminalName = firstNonBlank(
                terminal.optString("name"),
                terminalConfig.optString("terminalName"),
                terminalConfig.optString("terminal_name"),
                terminalConfig.optString("stationName"),
                terminalConfig.optString("stationNumber"),
                terminalId
            )
            val terminalType = firstNonBlank(
                terminal.optString("terminalType"),
                terminal.optString("terminal_type"),
                terminalConfig.optString("terminalType"),
                terminalConfig.optString("terminal_type"),
                terminalConfig.optJSONObject("deviceRole")?.optString("role").orEmpty(),
                terminalConfig.optJSONObject("device_role")?.optString("role").orEmpty(),
                "STANDARD_POS"
            )
            val masterTerminalId = firstNonBlank(
                terminal.optString("masterTerminalId"),
                terminal.optString("master_terminal_id"),
                terminalConfig.optString("masterTerminalId"),
                terminalConfig.optString("master_terminal_id")
            )
            val capabilities = terminal.optJSONArray("capabilities")
                ?: terminalConfig.optJSONArray("capabilities")
                ?: JSONArray()
            val restrictions = terminal.optJSONArray("restrictions")
                ?: terminalConfig.optJSONArray("restrictions")
                ?: JSONArray()
            val occupied = currentDeviceId.isNotBlank() && currentDeviceId != deviceId
            val companyId = firstNonBlank(terminal.optString("company_id"), terminalConfig.optString("company_id"))
            val storeId = firstNonBlank(terminal.optString("store_id"), terminalConfig.optString("store_id"))
            val companyName = firstNonBlank(
                terminal.optString("company_name"),
                terminalConfig.optString("company_name"),
                "Empresa sin identificar"
            )
            val storeName = firstNonBlank(
                terminal.optString("store_name"),
                terminal.optString("sucursal"),
                terminalConfig.optString("storeName"),
                terminalConfig.optString("store_name"),
                "Sucursal sin identificar"
            )

            result.put(
                JSONObject()
                    .put("id", terminalId)
                    .put("tenant_id", tenantId)
                    .put("company_id", if (companyId.isBlank()) JSONObject.NULL else companyId)
                    .put("company_name", companyName)
                    .put("store_id", if (storeId.isBlank()) JSONObject.NULL else storeId)
                    .put("store_name", storeName)
                    .put("terminal_name", terminalName)
                    .put("terminal_code", terminalConfig.optString("stationNumber").takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                    .put("binding_status", if (occupied) "OCCUPIED" else "AVAILABLE")
                    .put("is_occupied", occupied)
                    .put("can_reauthorize", occupied)
                    .put("erpTerminalId", erpTerminalId)
                    .put("name", terminalName)
                    .put("location", firstNonBlank(
                        terminal.optString("location"),
                        terminalConfig.optString("storeName"),
                        terminalConfig.optString("store_name"),
                        "Caja Maestra"
                    ))
                    .put("occupied", occupied)
                    .put("currentDeviceId", if (currentDeviceId.isBlank()) JSONObject.NULL else currentDeviceId)
                    .put("terminal_type", terminalType)
                    .put("terminalType", terminalType)
                    .put("master_terminal_id", if (masterTerminalId.isBlank()) JSONObject.NULL else masterTerminalId)
                    .put("masterTerminalId", if (masterTerminalId.isBlank()) JSONObject.NULL else masterTerminalId)
                    .put("capabilities", JSONArray(capabilities.toString()))
                    .put("restrictions", JSONArray(restrictions.toString()))
                    .put("config", JSONObject(terminalConfig.toString()))
            )
        }

        return JSONObject()
            .put("tenant_id", tenantId)
            .put("source", "ANDROID_MASTER")
            .put("terminals", result)
    }

    private fun handleTerminalBinding(socket: Socket, body: String) {
        val payload = if (body.isBlank()) JSONObject() else JSONObject(body)
        bindTerminal(socket, payload, includeSnapshot = true)
    }

    private fun handleTerminalClaim(socket: Socket, rawTarget: String) {
        bindTerminal(socket, parseQuery(rawTarget), includeSnapshot = false)
    }

    private fun bindTerminal(socket: Socket, payload: JSONObject, includeSnapshot: Boolean) {
        val selectedTerminalId = firstNonBlank(
            payload.optString("terminal_id"),
            payload.optString("erp_terminal_id")
        )
        val deviceId = firstNonBlank(
            payload.optString("new_device_id"),
            payload.optString("pos_device_id"),
            payload.optString("device_id")
        )
        val tenantId = firstNonBlank(
            payload.optString("tenant_id"),
            payload.optString("tenantId"),
            "default-tenant"
        )
        val forceTransfer = payload.optBoolean("force_transfer", false)
            || payload.optString("force_transfer").equals("true", ignoreCase = true)
        val terminals = configSnapshot.optJSONArray("terminals") ?: JSONArray()
        var selectedTerminal: JSONObject? = null

        for (index in 0 until terminals.length()) {
            val terminal = terminals.optJSONObject(index) ?: continue
            val config = terminal.optJSONObject("config") ?: JSONObject().also {
                terminal.put("config", it)
            }
            val id = terminal.optString("id").trim()
            val erpId = firstNonBlank(
                terminal.optString("erpTerminalId"),
                config.optString("erpTerminalId"),
                config.optString("erp_terminal_id")
            )

            if (id != selectedTerminalId && erpId != selectedTerminalId) continue

            val currentDeviceId = config.optString("currentDeviceId").trim()
            if (currentDeviceId.isNotBlank() && currentDeviceId != deviceId && !forceTransfer) {
                writeResponse(
                    socket,
                    409,
                    JSONObject()
                        .put("success", false)
                        .put("code", "TERMINAL_OCCUPIED")
                        .put("message", "La terminal ya está ocupada por otro equipo.")
                        .put("current_device_id", currentDeviceId)
                        .toString()
                )
                return
            }

            config
                .put("currentDeviceId", deviceId)
                .put("lastPairingDate", java.time.Instant.now().toString())
                .put("isPrimaryNode", false)
                .put("governedByMaster", true)
            val syncConfig = config.optJSONObject("syncConfig") ?: JSONObject()
            syncConfig.put("mode", "SLAVE").put("isEnabled", true)
            config.put("syncConfig", syncConfig)
            persistTerminalBinding(id, deviceId)
            selectedTerminal = terminal
            break
        }

        val boundTerminal = selectedTerminal
        if (boundTerminal == null) {
            writeResponse(
                socket,
                404,
                JSONObject()
                    .put("success", false)
                    .put("message", "La terminal seleccionada no existe en la Maestra.")
                    .toString()
            )
            return
        }

        configSnapshot = JSONObject(configSnapshot.toString())
        val terminalConfig = boundTerminal.optJSONObject("config") ?: JSONObject()
        val terminalId = boundTerminal.optString("id")
        val erpTerminalId = firstNonBlank(
            boundTerminal.optString("erpTerminalId"),
            terminalConfig.optString("erpTerminalId"),
            terminalConfig.optString("erp_terminal_id"),
            terminalId
        )
        val terminalName = firstNonBlank(
            boundTerminal.optString("name"),
            terminalConfig.optString("terminalName"),
            terminalConfig.optString("stationName"),
            terminalConfig.optString("stationNumber"),
            terminalId
        )
        val terminalType = firstNonBlank(
            boundTerminal.optString("terminalType"),
            boundTerminal.optString("terminal_type"),
            terminalConfig.optString("terminalType"),
            terminalConfig.optString("terminal_type"),
            terminalConfig.optJSONObject("deviceRole")?.optString("role").orEmpty(),
            terminalConfig.optJSONObject("device_role")?.optString("role").orEmpty(),
            "STANDARD_POS"
        )
        val masterTerminalId = firstNonBlank(
            boundTerminal.optString("masterTerminalId"),
            boundTerminal.optString("master_terminal_id"),
            terminalConfig.optString("masterTerminalId"),
            terminalConfig.optString("master_terminal_id")
        )

        val response = JSONObject()
            .put("success", true)
            .put("source", "ANDROID_MASTER")
            .put("tenant_id", tenantId)
            .put("terminal_id", terminalId)
            .put("erp_terminal_id", erpTerminalId)
            .put("terminal_name", terminalName)
            .put("terminal_type", terminalType)
            .put("master_terminal_id", if (masterTerminalId.isBlank()) JSONObject.NULL else masterTerminalId)
            .put("capabilities", terminalConfig.optJSONArray("capabilities") ?: JSONArray())
            .put("restrictions", terminalConfig.optJSONArray("restrictions") ?: JSONArray())

        if (includeSnapshot) {
            response
                .put("config", JSONObject(configSnapshot.toString()))
                .put("users", JSONArray(usersSnapshot.toString()))
        }

        writeResponse(socket, 200, response.toString())
    }

    /**
     * The Android Master owns this snapshot while it is serving LAN clients.  The
     * WebView sends a fresh copy whenever the local restaurant state changes and
     * clients can update parked tickets through the same Master endpoint.
     */
    private fun updateRestaurantSnapshot(
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null
    ) {
        rooms?.let { roomsSnapshot = JSONArray(it.toString()) }
        tables?.let { tablesSnapshot = JSONArray(it.toString()) }
        parkedTickets?.let { parkedTicketsSnapshot = JSONArray(it.toString()) }
    }

    /**
     * A WebView snapshot may only replace native state after it has observed the
     * latest client revision. This prevents an unrelated React render from
     * restoring stale tickets immediately after a client changes a table.
     */
    private fun updateRestaurantSnapshotFromWebView(
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null,
        acknowledgedRevision: Long = 0
    ) {
        if (acknowledgedRevision < restaurantRevision.get()) return
        val changed =
            (rooms != null && rooms.toString() != roomsSnapshot.toString()) ||
            (tables != null && tables.toString() != tablesSnapshot.toString()) ||
            (parkedTickets != null && parkedTickets.toString() != parkedTicketsSnapshot.toString())
        updateRestaurantSnapshot(rooms, tables, parkedTickets)
        if (changed) restaurantRevision.incrementAndGet()
        persistRestaurantSnapshot()
    }

    private fun updateCatalogSnapshots(catalogs: JSONObject, acknowledgedRevision: Long = restaurantRevision.get()) {
        val hasInitializedCatalogs = catalogSnapshots.length() > 0
        if (hasInitializedCatalogs && acknowledgedRevision < restaurantRevision.get()) return
        val previous = catalogSnapshots
        val next = JSONObject(catalogs.toString())
        val keys = next.keys()
        while (keys.hasNext()) {
            val collection = keys.next()
            val nextItems = next.optJSONArray(collection) ?: JSONArray()
            val previousItems = previous.optJSONArray(collection)
            if (previousItems == null || previousItems.toString() != nextItems.toString()) {
                val now = System.currentTimeMillis()
                val priorVersion = catalogVersions[collection] ?: 0
                catalogVersions[collection] = maxOf(now, priorVersion + 1)
            }
        }
        val nextProducts = next.optJSONArray("products")
        if (nextProducts != null) reconcileProductRoutingOverrides(nextProducts, acknowledgedRevision)
        catalogSnapshots = next
    }

    private fun applyClientRestaurantMutation(
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null
    ) {
        updateRestaurantSnapshot(rooms, tables, parkedTickets)
        restaurantRevision.incrementAndGet()
        persistRestaurantSnapshot()
    }

    private fun restoreRestaurantSnapshot() {
        if (restaurantStateLoaded) return
        restaurantStateLoaded = true
        val context = appContext ?: return
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PREFS_RESTAURANT_KEY, null)
        val persisted = runCatching {
            if (raw.isNullOrBlank()) null else JSONObject(raw)
        }.getOrNull() ?: return

        roomsSnapshot = persisted.optJSONArray("rooms") ?: JSONArray()
        tablesSnapshot = persisted.optJSONArray("tables") ?: JSONArray()
        parkedTicketsSnapshot = persisted.optJSONArray("parkedTickets") ?: JSONArray()
        val persistedRouting = persisted.optJSONArray("productRoutingUpdates") ?: JSONArray()
        for (index in 0 until persistedRouting.length()) {
            val update = persistedRouting.optJSONObject(index) ?: continue
            val productId = update.optString("productId").trim()
            if (productId.isNotBlank()) productRoutingOverrides[productId] = JSONObject(update.toString())
        }
        restaurantRevision.set(persisted.optLong("revision", 0))
    }

    private fun persistRestaurantSnapshot() {
        val context = appContext ?: return
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREFS_RESTAURANT_KEY, buildRestaurantSnapshot().toString())
            .apply()
    }

    private fun handleSyncAuth(socket: Socket, body: String) {
        val payload = runCatching {
            if (body.isBlank()) JSONObject() else JSONObject(body)
        }.getOrElse {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "Solicitud de autenticación inválida")
                .toString())
            return
        }
        val terminalId = firstNonBlank(
            payload.optString("terminalId"),
            payload.optString("terminal_id")
        )
        val deviceId = firstNonBlank(
            payload.optString("deviceToken"),
            payload.optString("device_id")
        )
        if (terminalId.isBlank() || deviceId.isBlank()) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "terminalId y deviceToken son requeridos")
                .toString())
            return
        }

        val token = "sync_${UUID.randomUUID()}"
        syncTokens[token] = terminalId
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("token", token)
            .put("terminalId", terminalId)
            .put("expiresIn", 86400000)
            .toString())
    }

    private fun handleSyncConfig(
        socket: Socket,
        headers: Map<String, String>
    ) {
        if (!authorizeSyncRequest(socket, headers)) return
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("config", JSONObject(configSnapshot.toString()))
            .toString())
    }

    private fun handleSyncCollectionMetadata(
        socket: Socket,
        path: String,
        headers: Map<String, String>
    ) {
        if (!authorizeSyncRequest(socket, headers)) return
        val collection = path
            .removePrefix("/api/sync/collections/")
            .removeSuffix("/metadata")
            .trim('/')
        val items = getSyncCollection(collection)
        val version = collectionVersion(collection, items)
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("metadata", JSONObject()
                .put("collection", collection)
                .put("version", version)
                .put("fullSyncVersion", version)
                .put("itemCount", items.length())
                .put("lastUpdated", java.time.Instant.now().toString()))
            .toString())
    }

    private fun handleSyncCollectionData(
        socket: Socket,
        path: String,
        rawTarget: String,
        headers: Map<String, String>
    ) {
        if (!authorizeSyncRequest(socket, headers)) return
        val collection = path
            .removePrefix("/api/sync/collections/")
            .removeSuffix("/data")
            .trim('/')
        val items = getSyncCollection(collection)
        val version = collectionVersion(collection, items)
        val sinceVersion = parseQuery(rawTarget).optLong("sinceVersion", 0)
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("items", if (sinceVersion >= version && version > 0) JSONArray() else items)
            .put("version", version)
            .put("itemCount", items.length())
            .put("upToDate", sinceVersion >= version && version > 0)
            .put("lastUpdated", java.time.Instant.now().toString())
            .toString())
    }

    private fun handleSyncCollectionDelta(
        socket: Socket,
        path: String,
        rawTarget: String,
        headers: Map<String, String>
    ) {
        if (!authorizeSyncRequest(socket, headers)) return
        val collection = path.removePrefix("/api/sync/delta/").trim('/')
        val items = getSyncCollection(collection)
        val version = collectionVersion(collection, items)
        val sinceVersion = parseQuery(rawTarget).optLong("sinceVersion", 0)
        val changed = sinceVersion < version || version == 0L
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("items", if (changed) items else JSONArray())
            .put("serverTime", java.time.Instant.now().toString())
            .put("isFullDownload", changed)
            .put("latestVersion", version)
            .toString())
    }

    private fun handleProductRoutingPush(
        socket: Socket,
        body: String,
        headers: Map<String, String>
    ) {
        if (!authorizeSyncRequest(socket, headers)) return
        val payload = runCatching { parseJsonBody(body) }.getOrElse {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "Cuerpo de rutas de producción inválido")
                .toString())
            return
        }
        val items = payload.optJSONArray("items") ?: JSONArray()
        var applied = 0
        val now = java.time.Instant.now().toString()
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            val productId = item.optString("id").trim()
            val productionAreaId = item.optString("production_area_id").trim()
            if (productId.isBlank() || productionAreaId.isBlank()) continue
            productRoutingOverrides[productId] = JSONObject()
                .put("productId", productId)
                .put("productionAreaId", productionAreaId)
                .put("updatedAt", item.optString("updatedAt").takeIf { it.isNotBlank() } ?: now)
            applied += 1
        }

        if (applied > 0) {
            catalogSnapshots.optJSONArray("products")?.let { applyProductRoutingOverrides(it) }
            val previousVersion = catalogVersions["products"] ?: 0
            catalogVersions["products"] = maxOf(System.currentTimeMillis(), previousVersion + 1)
            restaurantRevision.incrementAndGet()
            persistRestaurantSnapshot()
        }

        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("applied", applied)
            .put("version", collectionVersion("products", getSyncCollection("products")))
            .put("revision", restaurantRevision.get())
            .toString())
    }

    private fun applyProductRoutingOverrides(products: JSONArray) {
        for (index in 0 until products.length()) {
            val product = products.optJSONObject(index) ?: continue
            val override = productRoutingOverrides[product.optString("id").trim()] ?: continue
            product.put("production_area_id", override.optString("productionAreaId"))
            product.put("updatedAt", override.optString("updatedAt"))
        }
    }

    private fun reconcileProductRoutingOverrides(products: JSONArray, acknowledgedRevision: Long) {
        val currentRevision = restaurantRevision.get()
        for (index in 0 until products.length()) {
            val product = products.optJSONObject(index) ?: continue
            val productId = product.optString("id").trim()
            val override = productRoutingOverrides[productId] ?: continue
            val incomingAreaId = product.optString("production_area_id").trim()
            val overrideAreaId = override.optString("productionAreaId").trim()
            val incomingUpdatedAt = product.optString("updatedAt").trim()
            val overrideUpdatedAt = override.optString("updatedAt").trim()
            val masterAcknowledgedRoute = acknowledgedRevision >= currentRevision && incomingAreaId == overrideAreaId
            val authoritativeRouteIsNewer = incomingUpdatedAt.isNotBlank() &&
                overrideUpdatedAt.isNotBlank() && incomingUpdatedAt > overrideUpdatedAt

            if (masterAcknowledgedRoute || authoritativeRouteIsNewer) {
                productRoutingOverrides.remove(productId)
            } else {
                product.put("production_area_id", overrideAreaId)
                product.put("updatedAt", overrideUpdatedAt)
            }
        }
    }

    private fun authorizeSyncRequest(
        socket: Socket,
        headers: Map<String, String>
    ): Boolean {
        val token = headers["x-sync-token"].orEmpty()
        if (token.isNotBlank() && syncTokens.containsKey(token)) return true
        writeResponse(socket, 401, JSONObject()
            .put("success", false)
            .put("message", "Invalid or missing sync token")
            .toString())
        return false
    }

    private fun getSyncCollection(collection: String): JSONArray = when (collection) {
        "users" -> JSONArray(usersSnapshot.toString())
        "rooms" -> JSONArray(roomsSnapshot.toString())
        "tables" -> JSONArray(tablesSnapshot.toString())
        "parkedTickets" -> JSONArray(parkedTicketsSnapshot.toString())
        else -> catalogSnapshots.optJSONArray(collection)?.let { JSONArray(it.toString()) } ?: JSONArray()
    }

    private fun collectionVersion(collection: String, items: JSONArray): Long {
        if (collection == "rooms" || collection == "tables" || collection == "parkedTickets") {
            return restaurantRevision.get().coerceAtLeast(1)
        }
        return catalogVersions[collection]
            ?: (items.toString().hashCode().toLong() and 0x7fffffffL).coerceAtLeast(1)
    }

    private fun parseJsonBody(body: String): JSONObject =
        if (body.isBlank()) JSONObject() else JSONObject(body)

    // --- BLOQUEO DE CONTEO DE INVENTARIO (una PDA por almacén) ---

    private fun isoNow(offsetMs: Long = 0L): String {
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        formatter.timeZone = TimeZone.getTimeZone("UTC")
        return formatter.format(java.util.Date(System.currentTimeMillis() + offsetMs))
    }

    private fun cleanupExpiredAuditSessions() {
        val now = isoNow()
        for ((sessionId, session) in auditSessions.entries) {
            val expiresAt = session.optString("expiresAt")
            if (expiresAt.isNotEmpty() && expiresAt < now && auditSessions.remove(sessionId, session)) {
                continue
            }
        }
    }

    private fun findAuditSessionForWarehouse(warehouseId: String): JSONObject? {
        cleanupExpiredAuditSessions()
        return auditSessions.values.firstOrNull { it.optString("warehouseId") == warehouseId }
    }

    private fun findAuditSessionForScope(scopeKey: String): JSONObject? {
        cleanupExpiredAuditSessions()
        return auditSessions.values.firstOrNull { it.optString("scopeKey") == scopeKey }
    }

    private fun buildAuditScopeKey(input: JSONObject, warehouseId: String): String {
        val requested = input.optString("scopeKey").trim()
        return if (requested.startsWith("$warehouseId::")) requested else "$warehouseId::*"
    }

    private fun handleAuditActive(socket: Socket, rawWarehouseId: String) {
        val warehouseId = URLDecoder.decode(rawWarehouseId, StandardCharsets.UTF_8.name())
        val session = findAuditSessionForWarehouse(warehouseId)
        val payload = JSONObject().put("session", session ?: JSONObject.NULL)
        writeResponse(socket, 200, payload.toString())
    }

    private fun handleAuditStart(socket: Socket, body: String) {
        val input = parseJsonBody(body)
        val warehouseId = input.optString("warehouseId").trim()

        if (warehouseId.isEmpty()) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("error", "WAREHOUSE_REQUIRED")
                .toString())
            return
        }

        // El claim es exclusivo: se decide dentro del lock para que dos PDAs
        // simultáneas no puedan crear dos sesiones para el mismo almacén.
        val result = synchronized(auditSessions) {
            claimAuditSession(input, warehouseId)
        }
        val status = result.optInt("_httpStatus", 200)
        result.remove("_httpStatus")
        writeResponse(socket, status, result.toString())
    }

    private fun claimAuditSession(input: JSONObject, warehouseId: String): JSONObject {
        val deviceId = input.optString("deviceId").trim()
        val scopeKey = buildAuditScopeKey(input, warehouseId)
        val locationLabel = input.optString("locationLabel").trim()
        val existing = findAuditSessionForScope(scopeKey)

        if (existing != null) {
            val holderDevice = existing.optString("deviceId").trim()

            if (deviceId.isNotEmpty() && holderDevice == deviceId) {
                return JSONObject()
                    .put("_httpStatus", 200)
                    .put("success", true)
                    .put("reused", true)
                    .put("session", existing)
            }

            if (!input.optBoolean("force", false)) {
                return JSONObject()
                    .put("_httpStatus", 409)
                    .put("success", false)
                    .put("error", "AUDIT_SESSION_IN_PROGRESS")
                    .put("holder", existing)
            }

            auditSessions.remove(existing.optString("id"))
        }

        val session = JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("warehouseId", warehouseId)
            .put("scopeKey", scopeKey)
            .put("locationLabel", locationLabel)
            .put("startedAt", isoNow())
            .put("expiresAt", isoNow(AUDIT_CLAIM_TTL_MS))
            .put("heartbeatAt", isoNow())
            .put("deviceId", deviceId)
            .put("terminalId", input.optString("terminalId"))
            .put("userId", input.optString("userId"))
            .put("userName", input.optString("userName"))
            .put("status", "OPEN")

        auditSessions[session.getString("id")] = session

        return JSONObject()
            .put("_httpStatus", 200)
            .put("success", true)
            .put("reused", false)
            .put("session", session)
    }

    private fun handleAuditHeartbeat(socket: Socket, rawSessionId: String, body: String) {
        val sessionId = URLDecoder.decode(rawSessionId, StandardCharsets.UTF_8.name())
        cleanupExpiredAuditSessions()

        val session = auditSessions[sessionId]
        if (session == null) {
            writeResponse(socket, 409, JSONObject()
                .put("success", false)
                .put("error", "AUDIT_SESSION_CLOSED")
                .toString())
            return
        }

        val deviceId = parseJsonBody(body).optString("deviceId").trim()
        val holderDevice = session.optString("deviceId").trim()

        if (holderDevice.isNotEmpty() && deviceId.isNotEmpty() && holderDevice != deviceId) {
            writeResponse(socket, 409, JSONObject()
                .put("success", false)
                .put("error", "AUDIT_SESSION_OWNED_BY_OTHER")
                .put("holder", session)
                .toString())
            return
        }

        session.put("heartbeatAt", isoNow())
        session.put("expiresAt", isoNow(AUDIT_CLAIM_TTL_MS))
        auditSessions[sessionId] = session

        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("expiresAt", session.optString("expiresAt"))
            .toString())
    }

    private fun handleAuditRelease(socket: Socket, rawSessionId: String, body: String) {
        val sessionId = URLDecoder.decode(rawSessionId, StandardCharsets.UTF_8.name())
        cleanupExpiredAuditSessions()

        val session = auditSessions[sessionId]
        if (session == null) {
            writeResponse(socket, 200, JSONObject()
                .put("success", true)
                .put("alreadyClosed", true)
                .toString())
            return
        }

        val input = parseJsonBody(body)
        val deviceId = input.optString("deviceId").trim()
        val holderDevice = session.optString("deviceId").trim()

        if (holderDevice.isNotEmpty() && deviceId.isNotEmpty() && holderDevice != deviceId &&
            !input.optBoolean("force", false)
        ) {
            writeResponse(socket, 409, JSONObject()
                .put("success", false)
                .put("error", "AUDIT_SESSION_OWNED_BY_OTHER")
                .put("holder", session)
                .toString())
            return
        }

        auditSessions.remove(sessionId)
        writeResponse(socket, 200, JSONObject().put("success", true).toString())
    }

    private fun cleanupExpiredTableLocks(now: Long = System.currentTimeMillis()) {
        var removed = false
        for ((tableId, lock) in tableEditLocks.entries) {
            if (lock.optLong("expiresAt", 0) <= now && tableEditLocks.remove(tableId, lock)) {
                removed = true
            }
        }
        if (removed) restaurantRevision.incrementAndGet()
    }

    private fun activeTableLock(tableId: String): JSONObject? {
        cleanupExpiredTableLocks()
        return tableEditLocks[tableId]?.let { JSONObject(it.toString()) }
    }

    private fun publicTableLock(lock: JSONObject): JSONObject =
        JSONObject(lock.toString()).apply { remove("token") }

    @Synchronized
    fun acquireTableEditLock(payload: JSONObject): JSONObject {
        val tableId = payload.optString("tableId").trim()
        val ownerId = payload.optString("ownerId").trim()
        if (tableId.isBlank() || ownerId.isBlank()) {
            return JSONObject()
                .put("success", false)
                .put("code", "TABLE_LOCK_INPUT_REQUIRED")
                .put("message", "tableId y ownerId son requeridos")
                .put("_httpStatus", 400)
        }

        val now = System.currentTimeMillis()
        cleanupExpiredTableLocks(now)
        val current = tableEditLocks[tableId]
        if (current != null && current.optString("ownerId") != ownerId) {
            return JSONObject()
                .put("success", false)
                .put("code", "TABLE_EDIT_LOCKED")
                .put("message", "La mesa está siendo editada en otra terminal.")
                .put("lock", publicTableLock(current))
                .put("_httpStatus", 409)
        }

        val token = current?.optString("token")?.takeIf { it.isNotBlank() }
            ?: UUID.randomUUID().toString()
        val acquiredAt = current?.optLong("acquiredAt", now) ?: now
        val lock = JSONObject()
            .put("tableId", tableId)
            .put("ownerId", ownerId)
            .put("terminalId", payload.optString("terminalId"))
            .put("userId", payload.optString("userId"))
            .put("userName", payload.optString("userName"))
            .put("token", token)
            .put("acquiredAt", acquiredAt)
            .put("expiresAt", now + TABLE_EDIT_LOCK_TTL_MS)
        tableEditLocks[tableId] = lock
        if (current == null) {
            restaurantRevision.incrementAndGet()
        }

        return JSONObject()
            .put("success", true)
            .put("lock", JSONObject(lock.toString()))
            .put("_httpStatus", 200)
    }

    @Synchronized
    fun releaseTableEditLock(payload: JSONObject): JSONObject {
        val tableId = payload.optString("tableId").trim()
        val ownerId = payload.optString("ownerId").trim()
        val token = payload.optString("token").trim()
        if (tableId.isBlank()) {
            return JSONObject()
                .put("success", false)
                .put("message", "tableId es requerido")
                .put("_httpStatus", 400)
        }

        val current = activeTableLock(tableId)
        if (current == null) {
            return JSONObject().put("success", true).put("_httpStatus", 200)
        }
        val isOwner = ownerId.isNotBlank() && current.optString("ownerId") == ownerId
        val hasToken = token.isNotBlank() && current.optString("token") == token
        if (!isOwner || !hasToken) {
            return JSONObject()
                .put("success", false)
                .put("code", "TABLE_EDIT_LOCK_OWNERSHIP_MISMATCH")
                .put("message", "La mesa está bloqueada por otra terminal.")
                .put("lock", publicTableLock(current))
                .put("_httpStatus", 409)
        }

        tableEditLocks.remove(tableId)
        restaurantRevision.incrementAndGet()
        return JSONObject().put("success", true).put("_httpStatus", 200)
    }

    private fun writeLockResponse(socket: Socket, result: JSONObject) {
        val status = result.optInt("_httpStatus", if (result.optBoolean("success")) 200 else 400)
        result.remove("_httpStatus")
        writeResponse(socket, status, result.toString())
    }

    private fun buildTablesWithEditLocks(): JSONArray {
        cleanupExpiredTableLocks()
        val tables = JSONArray(tablesSnapshot.toString())
        for (index in 0 until tables.length()) {
            val table = tables.optJSONObject(index) ?: continue
            val tableId = table.optString("id")
            val lock = tableEditLocks[tableId]
            if (lock != null) {
                table.put("editingLock", publicTableLock(lock))
            } else {
                table.remove("editingLock")
            }
        }
        return tables
    }

    private fun buildRestaurantSnapshot(): JSONObject = JSONObject()
        .put("rooms", JSONArray(roomsSnapshot.toString()))
        .put("tables", buildTablesWithEditLocks())
        .put("parkedTickets", JSONArray(parkedTicketsSnapshot.toString()))
        .put("customers", getSyncCollection("customers"))
        .put("productRoutingUpdates", JSONArray(productRoutingOverrides.values.map { JSONObject(it.toString()) }))
        .put("revision", restaurantRevision.get())

    fun getRestaurantState(): JSONObject = buildRestaurantSnapshot()

    /**
     * Lightweight probe for the WebView watchdog. Returning only the revision
     * avoids cloning and serializing the complete restaurant snapshot every
     * second while the POS is idle.
     */
    fun getRestaurantRevision(): JSONObject = JSONObject()
        .put("success", true)
        .put("revision", restaurantRevision.get())

    private fun handleParkedTicketsUpdate(socket: Socket, body: String) {
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("success", false)
                    .put("message", "Cuerpo de tickets inválido")
                    .toString())
                return
            }
        val tickets = payload.optJSONArray("parkedTickets")
        if (tickets == null) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "parkedTickets debe ser un arreglo")
                .toString())
            return
        }

        val tableId = payload.optString("tableId").trim()
        val ownerId = payload.optString("ownerId").trim()
        val lockToken = payload.optString("lockToken").trim()
        val nextTickets = if (tableId.isNotBlank()) {
            val lock = activeTableLock(tableId)
            val ownsLock = lock != null &&
                lock.optString("ownerId") == ownerId &&
                lock.optString("token") == lockToken
            if (!ownsLock) {
                writeResponse(socket, 409, JSONObject()
                    .put("success", false)
                    .put("code", "TABLE_EDIT_LOCK_REQUIRED")
                    .put("message", "La terminal perdió el bloqueo de edición de la mesa.")
                    .toString())
                return
            }
            mergeTicketsForTable(tableId, tickets)
        } else {
            JSONArray(tickets.toString())
        }

        val reconciledTables = reconcileTablesWithParkedTickets(tablesSnapshot, nextTickets)
        applyClientRestaurantMutation(tables = reconciledTables, parkedTickets = nextTickets)
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("parkedTickets", JSONArray(parkedTicketsSnapshot.toString()))
            .put("tables", buildTablesWithEditLocks())
            .put("revision", restaurantRevision.get())
            .toString())
    }

    private fun mergeTicketsForTable(tableId: String, incomingTickets: JSONArray): JSONArray {
        val affectedTableIds = mutableSetOf(tableId)
        for (index in 0 until incomingTickets.length()) {
            val ticket = incomingTickets.optJSONObject(index) ?: continue
            if (!ticketReferencesTable(ticket, tableId)) continue
            ticket.optString("tableId").takeIf { it.isNotBlank() }?.let(affectedTableIds::add)
            val joinedTableIds = ticket.optJSONArray("joinedTableIds") ?: JSONArray()
            for (joinedIndex in 0 until joinedTableIds.length()) {
                joinedTableIds.optString(joinedIndex).takeIf { it.isNotBlank() }?.let(affectedTableIds::add)
            }
        }
        val merged = JSONArray()
        for (index in 0 until parkedTicketsSnapshot.length()) {
            val ticket = parkedTicketsSnapshot.optJSONObject(index) ?: continue
            if (affectedTableIds.none { affectedTableId -> ticketReferencesTable(ticket, affectedTableId) }) {
                merged.put(JSONObject(ticket.toString()))
            }
        }
        for (index in 0 until incomingTickets.length()) {
            val ticket = incomingTickets.optJSONObject(index) ?: continue
            if (ticketReferencesTable(ticket, tableId)) {
                merged.put(JSONObject(ticket.toString()))
            }
        }
        return merged
    }

    private fun ticketReferencesTable(ticket: JSONObject, tableId: String): Boolean {
        if (ticket.optString("tableId") == tableId) return true
        val joinedTableIds = ticket.optJSONArray("joinedTableIds") ?: JSONArray()
        for (index in 0 until joinedTableIds.length()) {
            if (joinedTableIds.optString(index) == tableId) return true
        }
        return false
    }

    private fun parkedTicketTotal(ticket: JSONObject): Double {
        val explicitTotal = ticket.optDouble("total", Double.NaN)
        if (!explicitTotal.isNaN()) return explicitTotal
        var total = 0.0
        val items = ticket.optJSONArray("items") ?: JSONArray()
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            total += item.optDouble("price", 0.0) * item.optDouble("quantity", 0.0)
        }
        return total
    }

    @Synchronized
    private fun handleJoinTables(socket: Socket, body: String) {
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("success", false)
                    .put("message", "Cuerpo de unión inválido")
                    .toString())
                return
            }
        val mainTableId = payload.optString("mainTableId").trim()
        val requestedSecondaryIds = payload.optJSONArray("secondaryTableIds") ?: JSONArray()
        val secondaryTableIds = (0 until requestedSecondaryIds.length())
            .map { requestedSecondaryIds.optString(it).trim() }
            .filter { it.isNotBlank() && it != mainTableId }
            .distinct()
        if (mainTableId.isBlank() || secondaryTableIds.isEmpty()) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "Seleccione una mesa principal y al menos una secundaria")
                .toString())
            return
        }

        val sourceTicket = (0 until parkedTicketsSnapshot.length())
            .mapNotNull { parkedTicketsSnapshot.optJSONObject(it) }
            .firstOrNull { ticketReferencesTable(it, mainTableId) }
        if (sourceTicket == null || (sourceTicket.optJSONArray("items") ?: JSONArray()).length() == 0) {
            writeResponse(socket, 409, JSONObject()
                .put("success", false)
                .put("message", "La mesa principal no tiene artículos para unir")
                .toString())
            return
        }

        val memberTableIds = linkedSetOf(mainTableId)
        val ticketsToJoin = linkedMapOf<String, JSONObject>()
        fun includeTicket(ticket: JSONObject?) {
            if (ticket == null) return
            val ticketId = ticket.optString("id").ifBlank { "ticket-${ticketsToJoin.size}" }
            ticketsToJoin[ticketId] = ticket
            ticket.optString("tableId").takeIf { it.isNotBlank() }?.let(memberTableIds::add)
            val joinedIds = ticket.optJSONArray("joinedTableIds") ?: JSONArray()
            for (index in 0 until joinedIds.length()) {
                joinedIds.optString(index).takeIf { it.isNotBlank() }?.let(memberTableIds::add)
            }
        }
        includeTicket(sourceTicket)
        secondaryTableIds.forEach { secondaryId ->
            memberTableIds.add(secondaryId)
            val targetTicket = (0 until parkedTicketsSnapshot.length())
                .mapNotNull { parkedTicketsSnapshot.optJSONObject(it) }
                .firstOrNull { ticketReferencesTable(it, secondaryId) }
            includeTicket(targetTicket)
        }

        val combinedItems = JSONArray()
        var combinedTotal = 0.0
        ticketsToJoin.values.forEach { ticket ->
            val items = ticket.optJSONArray("items") ?: JSONArray()
            for (index in 0 until items.length()) {
                items.optJSONObject(index)?.let { combinedItems.put(JSONObject(it.toString())) }
            }
            combinedTotal += parkedTicketTotal(ticket)
        }
        val mainTable = (0 until tablesSnapshot.length())
            .mapNotNull { tablesSnapshot.optJSONObject(it) }
            .firstOrNull { it.optString("id") == mainTableId }
        val mainTableName = mainTable?.let {
            firstNonBlank(it.optString("nombre"), it.optString("name"), mainTableId)
        } ?: mainTableId
        val mergedTicket = JSONObject(sourceTicket.toString())
            .put("items", combinedItems)
            .put("total", combinedTotal)
            .put("tableId", mainTableId)
            .put("primaryTableId", mainTableId)
            .put("joinedTableIds", JSONArray(memberTableIds.toList()))
            .put("tableDisplayLabel", mainTableName)

        val nextTickets = JSONArray()
        val mergedTicketIds = ticketsToJoin.keys
        for (index in 0 until parkedTicketsSnapshot.length()) {
            val ticket = parkedTicketsSnapshot.optJSONObject(index) ?: continue
            if (!mergedTicketIds.contains(ticket.optString("id"))) {
                nextTickets.put(JSONObject(ticket.toString()))
            }
        }
        nextTickets.put(mergedTicket)
        val reconciledTables = reconcileTablesWithParkedTickets(tablesSnapshot, nextTickets)
        applyClientRestaurantMutation(tables = reconciledTables, parkedTickets = nextTickets)
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("message", "Mesas unidas correctamente")
            .put("primaryTableId", mainTableId)
            .put("joinedTableIds", JSONArray(memberTableIds.toList()))
            .put("parkedTickets", JSONArray(parkedTicketsSnapshot.toString()))
            .put("tables", buildTablesWithEditLocks())
            .put("revision", restaurantRevision.get())
            .toString())
    }

    private fun reconcileTablesWithParkedTickets(
        sourceTables: JSONArray,
        tickets: JSONArray
    ): JSONArray {
        val activeByOrderId = mutableMapOf<String, JSONObject>()
        val activeByTableId = mutableMapOf<String, JSONObject>()
        for (index in 0 until tickets.length()) {
            val ticket = tickets.optJSONObject(index) ?: continue
            // Una cuenta abierta sin artículos sigue siendo una cuenta válida.
            // Solo el endpoint explícito de liberación debe cerrar la mesa.
            ticket.optString("id").takeIf { it.isNotBlank() }?.let { activeByOrderId[it] = ticket }
            ticket.optString("tableId").takeIf { it.isNotBlank() }?.let { activeByTableId[it] = ticket }
            val joinedTableIds = ticket.optJSONArray("joinedTableIds") ?: JSONArray()
            for (joinedIndex in 0 until joinedTableIds.length()) {
                joinedTableIds.optString(joinedIndex).takeIf { it.isNotBlank() }?.let {
                    activeByTableId[it] = ticket
                }
            }
        }

        val reconciled = JSONArray(sourceTables.toString())
        for (index in 0 until reconciled.length()) {
            val table = reconciled.optJSONObject(index) ?: continue
            val tableId = table.optString("id")
            val currentOrderId = table.optString("currentOrderId")
            val orderTicket = activeByOrderId[currentOrderId]
            val orderTicketTableId = orderTicket?.optString("tableId").orEmpty()
            val joinedTableIds = orderTicket?.optJSONArray("joinedTableIds") ?: JSONArray()
            var orderBelongsToTable = orderTicketTableId.isBlank() || orderTicketTableId == tableId
            for (joinedIndex in 0 until joinedTableIds.length()) {
                if (joinedTableIds.optString(joinedIndex) == tableId) {
                    orderBelongsToTable = true
                    break
                }
            }
            val ticket = if (
                orderTicket != null &&
                orderBelongsToTable
            ) {
                orderTicket
            } else {
                activeByTableId[tableId]
            }
            if (ticket == null) {
                table
                    .put("status", "FREE")
                    .put("currentOrderId", JSONObject.NULL)
                    .put("currentOrderTotal", 0)
                    .put("timeSeated", JSONObject.NULL)
                table.remove("joinedTableId")
                table.remove("joinedTableName")
                table.remove("joinedSourceTableId")
                table.remove("joinedSourceTableName")
                continue
            }

            var total = ticket.optDouble("total", Double.NaN)
            if (total.isNaN()) {
                total = 0.0
                val items = ticket.optJSONArray("items") ?: JSONArray()
                for (itemIndex in 0 until items.length()) {
                    val item = items.optJSONObject(itemIndex) ?: continue
                    total += item.optDouble("price", 0.0) * item.optDouble("quantity", 0.0)
                }
            }
            table
                .put("status", "OCCUPIED")
                .put("currentOrderId", ticket.optString("id"))
                .put("currentOrderTotal", if (ticket.optString("tableId") == tableId) total else 0.0)
                .put("timeSeated", firstNonBlank(
                    table.optString("timeSeated"),
                    ticket.optString("timestamp")
                ))
            val primaryTableId = firstNonBlank(ticket.optString("primaryTableId"), ticket.optString("tableId"))
            val ticketJoinedTableIds = ticket.optJSONArray("joinedTableIds") ?: JSONArray()
            if (primaryTableId.isNotBlank() && ticketJoinedTableIds.length() > 1) {
                val primaryTable = (0 until reconciled.length())
                    .mapNotNull { reconciled.optJSONObject(it) }
                    .firstOrNull { it.optString("id") == primaryTableId }
                val primaryTableName = primaryTable?.let {
                    firstNonBlank(it.optString("nombre"), it.optString("name"))
                }.orEmpty()
                table
                    .put("joinedSourceTableId", primaryTableId)
                    .put("joinedSourceTableName", primaryTableName)
                if (tableId != primaryTableId) {
                    table
                        .put("joinedTableId", primaryTableId)
                        .put("joinedTableName", primaryTableName)
                }
            } else {
                table.remove("joinedTableId")
                table.remove("joinedTableName")
                table.remove("joinedSourceTableId")
                table.remove("joinedSourceTableName")
            }
            val guests = ticket.optInt("guests", 0)
            if (guests > 0) table.put("guests", guests)
        }
        return reconciled
    }

    private fun handleTableUpdate(socket: Socket, path: String, body: String) {
        val tableId = URLDecoder.decode(
            path.removePrefix("/api/tables/"),
            StandardCharsets.UTF_8.name()
        ).trim()
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("success", false)
                    .put("message", "Cuerpo de mesa inválido")
                    .toString())
                return
            }
        if (tableId.isBlank()) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "tableId es requerido")
                .toString())
            return
        }

        val lock = activeTableLock(tableId)
        if (lock != null) {
            val ownsLock =
                lock.optString("ownerId") == payload.optString("ownerId") &&
                lock.optString("token") == payload.optString("lockToken")
            if (!ownsLock) {
                writeResponse(socket, 409, JSONObject()
                    .put("success", false)
                    .put("code", "TABLE_EDIT_LOCK_REQUIRED")
                    .put("message", "La terminal perdió el bloqueo de edición de la mesa.")
                    .toString())
                return
            }
        }

        val updatedTables = JSONArray(tablesSnapshot.toString())
        var updatedTable: JSONObject? = null
        for (index in 0 until updatedTables.length()) {
            val table = updatedTables.optJSONObject(index) ?: continue
            if (table.optString("id") != tableId) continue
            val keys = payload.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                if (key !in setOf("id", "ownerId", "lockToken", "editingLock")) {
                    table.put(key, payload.opt(key))
                }
            }
            updatedTable = table
            break
        }
        if (updatedTable == null) {
            writeResponse(socket, 404, JSONObject()
                .put("success", false)
                .put("message", "Mesa no encontrada")
                .toString())
            return
        }

        val updatedTickets = JSONArray(parkedTicketsSnapshot.toString())
        if (payload.has("guests")) {
            for (index in 0 until updatedTickets.length()) {
                val ticket = updatedTickets.optJSONObject(index) ?: continue
                if (ticket.optString("tableId") == tableId) {
                    ticket.put("guests", payload.optInt("guests", 0))
                }
            }
        }
        applyClientRestaurantMutation(tables = updatedTables, parkedTickets = updatedTickets)
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("table", JSONObject(updatedTable.toString()))
            .put("tables", buildTablesWithEditLocks())
            .put("parkedTickets", JSONArray(parkedTicketsSnapshot.toString()))
            .put("revision", restaurantRevision.get())
            .toString())
    }

    @Synchronized
    private fun handleFloorPlanReplace(socket: Socket, body: String) {
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("success", false)
                    .put("message", "Cuerpo de layout inválido")
                    .toString())
                return
            }
        val rooms = payload.optJSONArray("rooms")
        val tables = payload.optJSONArray("tables")
        if (rooms == null || tables == null) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "rooms y tables son requeridos")
                .toString())
            return
        }

        val reconciledTables = reconcileTablesWithParkedTickets(tables, parkedTicketsSnapshot)
        applyClientRestaurantMutation(rooms = rooms, tables = reconciledTables)
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("rooms", JSONArray(roomsSnapshot.toString()))
            .put("tables", buildTablesWithEditLocks())
            .put("parkedTickets", JSONArray(parkedTicketsSnapshot.toString()))
            .put("revision", restaurantRevision.get())
            .toString())
    }

    @Synchronized
    private fun handleCustomerUpsert(socket: Socket, body: String) {
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("success", false)
                    .put("message", "Cuerpo de cliente inválido")
                    .toString())
                return
            }
        val customer = payload.optJSONObject("customer")
        val customerId = customer?.optString("id")?.trim().orEmpty()
        if (customer == null || customerId.isBlank() || customer.optString("name").isBlank()) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "customer.id y customer.name son requeridos")
                .toString())
            return
        }

        val currentCustomers = getSyncCollection("customers")
        val nextCustomers = JSONArray()
        var replaced = false
        for (index in 0 until currentCustomers.length()) {
            val current = currentCustomers.optJSONObject(index) ?: continue
            if (current.optString("id") == customerId) {
                nextCustomers.put(JSONObject(customer.toString()))
                replaced = true
            } else {
                nextCustomers.put(JSONObject(current.toString()))
            }
        }
        if (!replaced) nextCustomers.put(JSONObject(customer.toString()))

        val nextCatalogs = JSONObject(catalogSnapshots.toString())
        nextCatalogs.put("customers", nextCustomers)
        catalogSnapshots = nextCatalogs
        val now = System.currentTimeMillis()
        catalogVersions["customers"] = maxOf(now, (catalogVersions["customers"] ?: 0) + 1)
        restaurantRevision.incrementAndGet()

        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("customer", JSONObject(customer.toString()))
            .put("customers", JSONArray(nextCustomers.toString()))
            .put("revision", restaurantRevision.get())
            .toString())
    }

    private fun handleOpenTable(socket: Socket, body: String) {
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("status", "error")
                    .put("message", "Cuerpo de mesa inválido")
                    .toString())
                return
            }
        val tableId = payload.optString("tableId").trim()
        if (tableId.isBlank()) {
            writeResponse(socket, 400, JSONObject()
                .put("status", "error")
                .put("message", "tableId es requerido")
                .toString())
            return
        }

        val updatedTables = JSONArray(tablesSnapshot.toString())
        var orderId = ""
        var found = false
        for (index in 0 until updatedTables.length()) {
            val table = updatedTables.optJSONObject(index) ?: continue
            if (table.optString("id") != tableId) continue
            found = true
            orderId = table.optString("currentOrderId").trim()
            if (orderId.isBlank()) {
                orderId = "ORD-${System.currentTimeMillis()}"
                table
                    .put("currentOrderId", orderId)
                    .put("currentOrderTotal", 0)
                    .put("timeSeated", java.time.Instant.now().toString())
                    .put("waiterId", payload.optString("waiterId"))
                    .put("waiterName", payload.optString("waiterName"))
                    .put("status", "OCCUPIED")
            }
            break
        }

        if (!found) {
            writeResponse(socket, 404, JSONObject()
                .put("status", "error")
                .put("message", "Mesa no encontrada")
                .toString())
            return
        }

        val updatedTickets = JSONArray(parkedTicketsSnapshot.toString())
        var hasOrderTicket = false
        for (index in 0 until updatedTickets.length()) {
            val ticket = updatedTickets.optJSONObject(index) ?: continue
            if (ticket.optString("id") == orderId || ticketReferencesTable(ticket, tableId)) {
                hasOrderTicket = true
                break
            }
        }
        if (!hasOrderTicket) {
            val openedTable = (0 until updatedTables.length())
                .mapNotNull { updatedTables.optJSONObject(it) }
                .firstOrNull { it.optString("id") == tableId }
            val timestamp = openedTable?.optString("timeSeated")
                ?.takeIf { it.isNotBlank() }
                ?: java.time.Instant.now().toString()
            val tableName = openedTable?.optString("name")
                ?.takeIf { it.isNotBlank() }
                ?: openedTable?.optString("nombre")
                    ?.takeIf { it.isNotBlank() }
                ?: "Mesa"
            updatedTickets.put(JSONObject()
                .put("id", orderId)
                .put("name", tableName)
                .put("items", JSONArray())
                .put("total", 0)
                .put("timestamp", timestamp)
                .put("tableId", tableId))
        }

        applyClientRestaurantMutation(tables = updatedTables, parkedTickets = updatedTickets)
        writeResponse(socket, 200, JSONObject()
            .put("status", "success")
            .put("orden_id", orderId)
            .put("revision", restaurantRevision.get())
            .toString())
    }

    private fun handleReleaseTable(socket: Socket, body: String) {
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("success", false)
                    .put("message", "Cuerpo de mesa inválido")
                    .toString())
                return
            }
        val tableId = payload.optString("tableId").trim()
        if (tableId.isBlank()) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "tableId es requerido")
                .toString())
            return
        }

        val updatedTables = JSONArray(tablesSnapshot.toString())
        var orderId = ""
        var found = false
        for (index in 0 until updatedTables.length()) {
            val table = updatedTables.optJSONObject(index) ?: continue
            if (table.optString("id") != tableId) continue
            found = true
            orderId = table.optString("currentOrderId").trim()
            table
                .put("status", "FREE")
                .put("currentOrderId", JSONObject.NULL)
                .put("currentOrderTotal", 0)
                .put("timeSeated", JSONObject.NULL)
                .put("waiterId", JSONObject.NULL)
                .put("waiterName", JSONObject.NULL)
            break
        }

        if (!found) {
            writeResponse(socket, 404, JSONObject()
                .put("success", false)
                .put("message", "Mesa no encontrada")
                .toString())
            return
        }

        val linkedTableIds = mutableSetOf(tableId)
        for (index in 0 until parkedTicketsSnapshot.length()) {
            val ticket = parkedTicketsSnapshot.optJSONObject(index) ?: continue
            val joinedIds = ticket.optJSONArray("joinedTableIds") ?: JSONArray()
            var includesReleasedTable = ticket.optString("tableId") == tableId
            for (joinedIndex in 0 until joinedIds.length()) {
                if (joinedIds.optString(joinedIndex) == tableId) includesReleasedTable = true
            }
            val sameOrder = orderId.isNotBlank() && ticket.optString("id") == orderId
            if (!includesReleasedTable && !sameOrder) continue
            ticket.optString("tableId").takeIf { it.isNotBlank() }?.let(linkedTableIds::add)
            for (joinedIndex in 0 until joinedIds.length()) {
                joinedIds.optString(joinedIndex).takeIf { it.isNotBlank() }?.let(linkedTableIds::add)
            }
        }
        for (index in 0 until updatedTables.length()) {
            val table = updatedTables.optJSONObject(index) ?: continue
            val belongsToJoinedAccount = linkedTableIds.contains(table.optString("id")) ||
                (orderId.isNotBlank() && table.optString("currentOrderId") == orderId)
            if (!belongsToJoinedAccount) continue
            table
                .put("status", "FREE")
                .put("currentOrderId", JSONObject.NULL)
                .put("currentOrderTotal", 0)
                .put("timeSeated", JSONObject.NULL)
                .put("waiterId", JSONObject.NULL)
                .put("waiterName", JSONObject.NULL)
            table.remove("joinedTableId")
            table.remove("joinedTableName")
            table.remove("joinedSourceTableId")
            table.remove("joinedSourceTableName")
        }

        val remainingTickets = JSONArray()
        for (index in 0 until parkedTicketsSnapshot.length()) {
            val ticket = parkedTicketsSnapshot.optJSONObject(index) ?: continue
            val belongsToTable = ticketReferencesTable(ticket, tableId)
            val belongsToOrder = orderId.isNotBlank() && ticket.optString("id") == orderId
            if (!belongsToTable && !belongsToOrder) remainingTickets.put(ticket)
        }
        applyClientRestaurantMutation(tables = updatedTables, parkedTickets = remainingTickets)
        writeResponse(socket, 200, JSONObject().put("success", true).toString())
    }

    private fun applyPersistedBindings(snapshot: JSONObject): JSONObject {
        val bindings = readPersistedBindings()
        val terminals = snapshot.optJSONArray("terminals") ?: return snapshot
        for (index in 0 until terminals.length()) {
            val terminal = terminals.optJSONObject(index) ?: continue
            val terminalId = terminal.optString("id").trim()
            val persistedDeviceId = bindings.optString(terminalId).trim()
            if (terminalId.isBlank() || persistedDeviceId.isBlank()) continue
            val config = terminal.optJSONObject("config") ?: JSONObject().also {
                terminal.put("config", it)
            }
            config
                .put("currentDeviceId", persistedDeviceId)
                .put("governedByMaster", true)
        }
        return snapshot
    }

    private fun readPersistedBindings(): JSONObject {
        val context = appContext ?: return JSONObject()
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PREFS_BINDINGS_KEY, null)
        return runCatching { if (raw.isNullOrBlank()) JSONObject() else JSONObject(raw) }
            .getOrDefault(JSONObject())
    }

    private fun persistTerminalBinding(terminalId: String, deviceId: String) {
        val context = appContext ?: return
        val bindings = readPersistedBindings()
        bindings.put(terminalId, deviceId)
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREFS_BINDINGS_KEY, bindings.toString())
            .apply()
    }

    private fun buildInitialConfigResponse(terminalId: String, rawTarget: String): JSONObject {
        val query = parseQuery(rawTarget)
        return JSONObject()
            .put("success", true)
            .put("source", "ANDROID_MASTER")
            .put("tenant_id", query.optString("tenant_id").ifBlank { "default-tenant" })
            .put("terminal_id", query.optString("local_terminal_id").ifBlank { terminalId })
            .put("erp_terminal_id", terminalId)
            .put("config", JSONObject(configSnapshot.toString()))
            .put("rooms", JSONArray(roomsSnapshot.toString()))
            .put("tables", buildTablesWithEditLocks())
            .put("items", getSyncCollection("products"))
    }

    private fun parseQuery(rawTarget: String): JSONObject {
        val result = JSONObject()
        val query = rawTarget.substringAfter('?', "")
        if (query.isBlank()) return result

        query.split('&').forEach { pair ->
            val key = URLDecoder.decode(pair.substringBefore('='), StandardCharsets.UTF_8.name())
            val value = URLDecoder.decode(pair.substringAfter('=', ""), StandardCharsets.UTF_8.name())
            if (key.isNotBlank()) result.put(key, value)
        }
        return result
    }

    private fun firstNonBlank(vararg values: String): String =
        values.firstOrNull { it.isNotBlank() } ?: ""

    private fun readAsciiLine(input: java.io.InputStream): String {
        val output = ByteArrayOutputStream()
        while (true) {
            val value = input.read()
            if (value == -1 || value == '\n'.code) break
            if (value != '\r'.code) output.write(value)
        }
        return output.toString(StandardCharsets.UTF_8.name())
    }

    private fun writeResponse(socket: Socket, status: Int, body: String) {
        runCatching {
            val statusText = when (status) {
                200 -> "OK"
                204 -> "No Content"
                400 -> "Bad Request"
                401 -> "Unauthorized"
                409 -> "Conflict"
                404 -> "Not Found"
                else -> "Internal Server Error"
            }
            val bytes = body.toByteArray(StandardCharsets.UTF_8)
            val headers = buildString {
                append("HTTP/1.1 $status $statusText\r\n")
                append("Content-Type: application/json; charset=utf-8\r\n")
                append("Access-Control-Allow-Origin: *\r\n")
                append("Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n")
                append("Access-Control-Allow-Headers: Content-Type, X-Active-Terminal-Id, X-Device-Id, X-POS-Device-Id, X-Sync-Token\r\n")
                append("Access-Control-Allow-Private-Network: true\r\n")
                append("Access-Control-Max-Age: 600\r\n")
                append("Connection: close\r\n")
                append("Content-Length: ${bytes.size}\r\n\r\n")
            }
            socket.getOutputStream().apply {
                write(headers.toByteArray(StandardCharsets.UTF_8))
                if (bytes.isNotEmpty()) write(bytes)
                flush()
            }
        }
    }

    private fun localIpv4Addresses(): List<String> {
        val addresses = mutableListOf<String>()
        runCatching {
            for (networkInterface in Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!networkInterface.isUp || networkInterface.isLoopback) continue
                for (address in Collections.list(networkInterface.inetAddresses)) {
                    if (address is Inet4Address && !address.isLoopbackAddress) {
                        addresses.add(address.hostAddress ?: continue)
                    }
                }
            }
        }
        return addresses.distinct()
    }
}
