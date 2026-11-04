package com.clicpos.cardnet

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.Executors

/**
 * Transporte TCP nativo para el canal ECR de CardNET (POS-Caja PROVEEDORES Ethernet v2.25).
 *
 * El navegador del WebView no puede abrir sockets TCP al terminal, por lo que el
 * diálogo de enlace del protocolo vive aqui y el codec de campos (tramas, LRC,
 * layouts) permanece en TypeScript (services/payments/CardNetEcrCodec.ts).
 *
 * Secuencia implementada (seccion "Esquema Comunicacion ECR / POS"):
 *   ECR  -> ENQ              POS -> ACK          (autenticacion por IP)
 *   ECR  -> SYN              POS -> EOM          (el POS pasa a modo cliente)
 *                            POS -> ENQ          (listo para recibir la transaccion)
 *   ECR  -> <trama>          POS -> ACK          (recibido, se procesa)
 *                            POS -> <respuesta>
 *   ECR  -> ACK              POS -> EOT, EOM     (fin de la comunicacion)
 *
 * El terminal puede tardar hasta 90 s en autorizar y hasta 150 s por lote en el
 * cierre, de ahi los timeouts configurables.
 */
@CapacitorPlugin(name = "CardNetEcr")
class CardNetEcrPlugin : Plugin() {

    companion object {
        private const val TAG = "CLICPOS_CARDNET"
        private const val EOT = 0x04
        private const val ACK = 0x06
        private const val ENQ = 0x05
        private const val SYN = 0x16
        private const val EOM = 0x19
        private const val NAK = 0x15
        private const val STX = 0x02
        private const val ETX = 0x03
        private const val MAX_FRAME_BYTES = 128 * 1024
        private const val DEFAULT_CONNECT_TIMEOUT_MS = 8_000
        private const val DEFAULT_ACK_TIMEOUT_MS = 10_000
        private const val DEFAULT_RESPONSE_TIMEOUT_MS = 90_000
        private const val DRAIN_TIMEOUT_MS = 2_500
    }

    private val io = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "cardnet-ecr-io").apply { isDaemon = true }
    }

    private fun isoBytes(text: String): ByteArray = text.toByteArray(Charsets.ISO_8859_1)

    private fun isoString(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size): String =
        String(bytes, offset, length, Charsets.ISO_8859_1)

    private fun hex(value: Int): String = String.format("0x%02X", value and 0xFF)

    private fun describe(byte: Int): String = when (byte) {
        EOT -> "EOT"
        ACK -> "ACK"
        ENQ -> "ENQ"
        SYN -> "SYN"
        EOM -> "EOM"
        NAK -> "NAK"
        STX -> "STX"
        ETX -> "ETX"
        else -> hex(byte)
    }

    @PluginMethod
    fun transact(call: PluginCall) {
        val host = (call.getString("host") ?: "").trim()
        val port = call.getInt("port") ?: 0
        val requestFrame = call.getString("requestFrame") ?: ""
        val framing = (call.getString("framing") ?: "STX_ETX_LRC").uppercase()
        val connectTimeoutMs = call.getInt("connectTimeoutMs") ?: DEFAULT_CONNECT_TIMEOUT_MS
        val ackTimeoutMs = call.getInt("ackTimeoutMs") ?: DEFAULT_ACK_TIMEOUT_MS
        val responseTimeoutMs = call.getInt("responseTimeoutMs") ?: DEFAULT_RESPONSE_TIMEOUT_MS

        if (host.isEmpty() || port <= 0 || port > 65535) {
            call.reject("Endpoint CardNET invalido: $host:$port", "INVALID_ENDPOINT")
            return
        }

        if (requestFrame.isEmpty()) {
            call.reject("La trama de la transaccion esta vacia.", "EMPTY_FRAME")
            return
        }

        io.execute {
            val startedAt = System.currentTimeMillis()
            val transcript = StringBuilder()
            var socket: Socket? = null
            var responseFrame = ""
            var ok = false
            var errorCode: String? = null
            var errorMessage: String? = null

            try {
                val active = Socket().apply {
                    tcpNoDelay = true
                    connect(InetSocketAddress(host, port), connectTimeoutMs)
                    soTimeout = ackTimeoutMs
                }
                socket = active

                // 1) ENQ -> ACK
                writeBytes(active, isoBytes(ENQ.toChar().toString()), transcript, "ECR -> ENQ")
                val authReply = readByte(active)
                if (authReply != ACK) {
                    throw CardNetFailure("NO_ACK_ENQ", "El terminal no respondio ACK al ENQ (recibido ${describe(authReply)}).")
                }
                transcript.appendLine("POS -> ACK")

                // 2) SYN -> EOM -> ENQ
                writeBytes(active, isoBytes(SYN.toChar().toString()), transcript, "ECR -> SYN")
                val synReply = readUntilTerminator(active, EOM)
                transcript.appendLine("POS -> ${describe(synReply.lastOrNull()?.toInt() ?: -1)} (${synReply.size} bytes)")

                if (synReply.isEmpty() || synReply.last().toInt() != EOM) {
                    throw CardNetFailure("NO_EOM", "El terminal no respondio EOM al SYN.")
                }

                active.soTimeout = ackTimeoutMs
                val ready = try {
                    readByte(active)
                } catch (timeout: SocketTimeoutException) {
                    transcript.appendLine("POS -> sin ENQ explicito (tolerado)")
                    ENQ
                }

                if (ready != ENQ) {
                    transcript.appendLine("POS -> ${describe(ready)} en lugar de ENQ (tolerado)")
                } else {
                    transcript.appendLine("POS -> ENQ")
                }

                // 3) Peticion -> ACK
                writeBytes(active, isoBytes(requestFrame), transcript, "ECR -> trama (${isoBytes(requestFrame).size} bytes)")

                active.soTimeout = ackTimeoutMs
                val requestAck = readByte(active)
                if (requestAck != ACK) {
                    throw CardNetFailure(
                        if (requestAck == NAK) "NACK_REQUEST" else "NO_ACK_REQUEST",
                        "El terminal no confirmo la peticion (recibido ${describe(requestAck)})."
                    )
                }
                transcript.appendLine("POS -> ACK peticion")

                // 4) Respuesta del terminal
                active.soTimeout = responseTimeoutMs
                val response = if (framing == "PLAIN") {
                    readByGap(active)
                } else {
                    readFramedResponse(active, framing, transcript)
                }

                responseFrame = isoString(response)
                transcript.appendLine("POS -> respuesta (${response.size} bytes)")

                // 5) ACK de la respuesta y cierre ordenado
                writeBytes(active, isoBytes(ACK.toChar().toString()), transcript, "ECR -> ACK respuesta")

                active.soTimeout = DRAIN_TIMEOUT_MS
                drainClosingControls(active, transcript)

                ok = responseFrame.isNotEmpty()
                if (!ok) {
                    errorCode = "EMPTY_RESPONSE"
                    errorMessage = "El terminal no envio trama de respuesta."
                }
            } catch (failure: CardNetFailure) {
                errorCode = failure.code
                errorMessage = failure.message
                transcript.appendLine("ERROR ${failure.code}: ${failure.message}")
            } catch (timeout: SocketTimeoutException) {
                errorCode = "RESPONSE_TIMEOUT"
                errorMessage = "El terminal no envio respuesta dentro del tiempo configurado."
                transcript.appendLine("ERROR RESPONSE_TIMEOUT")
            } catch (error: Exception) {
                errorCode = "TRANSPORT_ERROR"
                errorMessage = error.message ?: "Fallo de red al comunicarse con el terminal CardNET."
                transcript.appendLine("ERROR TRANSPORT_ERROR: ${error.message}")
            } finally {
                try {
                    socket?.close()
                } catch (_: Exception) {
                    // el socket ya esta cerrado
                }
            }

            val result = JSObject()
            result.put("ok", ok)
            result.put("responseFrame", responseFrame)
            result.put("transcript", transcript.toString().trim())
            result.put("elapsedMs", System.currentTimeMillis() - startedAt)
            result.put("errorCode", errorCode)
            result.put("errorMessage", errorMessage)
            call.resolve(result)
        }
    }

    @PluginMethod
    fun probe(call: PluginCall) {
        val host = (call.getString("host") ?: "").trim()
        val port = call.getInt("port") ?: 0
        val connectTimeoutMs = call.getInt("connectTimeoutMs") ?: DEFAULT_CONNECT_TIMEOUT_MS
        val ackTimeoutMs = call.getInt("ackTimeoutMs") ?: DEFAULT_ACK_TIMEOUT_MS

        if (host.isEmpty() || port <= 0 || port > 65535) {
            call.reject("Endpoint CardNET invalido: $host:$port", "INVALID_ENDPOINT")
            return
        }

        io.execute {
            val startedAt = System.currentTimeMillis()
            val transcript = StringBuilder()
            var socket: Socket? = null
            var reachable = false
            var message = ""
            var errorCode: String? = null
            var responseFrame = ""

            try {
                val active = Socket().apply {
                    tcpNoDelay = true
                    connect(InetSocketAddress(host, port), connectTimeoutMs)
                    soTimeout = ackTimeoutMs
                }
                socket = active

                writeBytes(active, isoBytes(ENQ.toChar().toString()), transcript, "ECR -> ENQ")
                val reply = readByte(active)
                responseFrame = if (reply >= 0) isoString(byteArrayOf(reply.toByte())) else ""

                if (reply == ACK) {
                    reachable = true
                    message = "Terminal CardNET en linea en $host:$port."
                    transcript.appendLine("POS -> ACK")
                    writeBytes(active, isoBytes(EOT.toChar().toString()), transcript, "ECR -> EOT (fin de prueba)")
                } else {
                    errorCode = "UNEXPECTED_HANDSHAKE"
                    message = "El terminal respondio ${describe(reply)} en lugar de ACK."
                    transcript.appendLine("POS -> ${describe(reply)}")
                }
            } catch (timeout: SocketTimeoutException) {
                errorCode = "NO_ACK"
                message = "El terminal no respondio el ENQ en $host:$port. Verifique IP, puerto 7060 y que el POS este en modo caja."
                transcript.appendLine("ERROR NO_ACK")
            } catch (error: Exception) {
                errorCode = "CONNECT_FAILED"
                message = "No se pudo abrir la conexion TCP con $host:$port: ${error.message}"
                transcript.appendLine("ERROR CONNECT_FAILED: ${error.message}")
            } finally {
                try {
                    socket?.close()
                } catch (_: Exception) {
                    // el socket ya esta cerrado
                }
            }

            val result = JSObject()
            result.put("reachable", reachable)
            result.put("message", message)
            result.put("latencyMs", System.currentTimeMillis() - startedAt)
            result.put("responseFrame", responseFrame)
            result.put("transcript", transcript.toString().trim())
            result.put("errorCode", errorCode)
            call.resolve(result)
        }
    }

    private class CardNetFailure(val code: String, override val message: String) : Exception(message)

    private fun writeBytes(socket: Socket, bytes: ByteArray, transcript: StringBuilder, label: String) {
        socket.getOutputStream().write(bytes)
        socket.getOutputStream().flush()
        transcript.appendLine("$label (${bytes.size} bytes)")
    }

    private fun readByte(socket: Socket): Int {
        val value = socket.getInputStream().read()
        if (value < 0) {
            throw CardNetFailure("CONNECTION_CLOSED", "El terminal cerro la conexion inesperadamente.")
        }
        return value
    }

    private fun readUntilTerminator(socket: Socket, terminator: Int, keepTerminator: Boolean = true): ByteArray {
        val buffer = ByteArrayOutputStream()
        while (buffer.size() < MAX_FRAME_BYTES) {
            val value = socket.getInputStream().read()
            if (value < 0) break
            if (value == terminator) {
                if (keepTerminator) buffer.write(value)
                break
            }
            buffer.write(value)
        }
        return buffer.toByteArray()
    }

    /**
     * Lee la respuesta con delimitadores <STX> ... <ETX> (+ <LRC> cuando aplica).
     * Tolera terminales que no envian <STX> o que agregan controles al inicio.
     */
    private fun readFramedResponse(socket: Socket, framing: String, transcript: StringBuilder): ByteArray {
        val buffer = ByteArrayOutputStream()
        var sawEtx = false

        while (buffer.size() < MAX_FRAME_BYTES) {
            val value = socket.getInputStream().read()
            if (value < 0) break

            // EOT/EOM antes del <ETX>: el terminal corto la trama; se usa lo recibido.
            if (value == EOT || value == EOM) break

            buffer.write(value)

            if (value == ETX) {
                sawEtx = true

                if (framing == "STX_ETX_LRC") {
                    val previousTimeout = socket.soTimeout
                    socket.soTimeout = 800
                    try {
                        val lrc = socket.getInputStream().read()
                        if (lrc >= 0) buffer.write(lrc)
                    } catch (_: SocketTimeoutException) {
                        transcript.appendLine("INFO respuesta sin LRC")
                    } finally {
                        socket.soTimeout = previousTimeout
                    }
                }
                break
            }
        }

        if (!sawEtx) {
            transcript.appendLine("INFO respuesta sin <ETX>; se usa lo recibido")
        }

        return buffer.toByteArray()
    }

    /**
     * Modo sin delimitadores: acumula hasta que el terminal deja de enviar bytes
     * (hueco de 350 ms) o hasta que llega un control de cierre (EOT/EOM).
     */
    private fun readByGap(socket: Socket): ByteArray {
        val buffer = ByteArrayOutputStream()
        val previousTimeout = socket.soTimeout
        try {
            while (buffer.size() < MAX_FRAME_BYTES) {
                socket.soTimeout = 350
                val value = try {
                    socket.getInputStream().read()
                } catch (_: SocketTimeoutException) {
                    break
                }

                if (value < 0) break
                if (value == EOT || value == EOM) break

                buffer.write(value)
            }
        } finally {
            socket.soTimeout = previousTimeout
        }

        return buffer.toByteArray()
    }

    private fun drainClosingControls(socket: Socket, transcript: StringBuilder) {
        val seen = StringBuilder()

        try {
            while (seen.length < 8) {
                val value = socket.getInputStream().read()
                if (value < 0) break
                seen.append(describe(value)).append(' ')
                if (value == EOM) break
            }
        } catch (_: SocketTimeoutException) {
            // el terminal cerro sin EOT/EOM: no es un error para la caja
        } catch (_: Exception) {
            // la conexion ya no esta disponible; la transaccion ya fue respondida
        }

        if (seen.isNotEmpty()) {
            transcript.appendLine("POS -> cierre: ${seen.toString().trim()}")
        }
    }

    override fun handleOnDestroy() {
        io.shutdownNow()
        super.handleOnDestroy()
    }
}
