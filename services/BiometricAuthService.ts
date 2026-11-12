
import { User, UserBiometrics } from '../types';

/**
 * Service to handle WebAuthn Biometric Authentication
 */

export interface PublicKeyCredentialCreationOptionsJSON {
    challenge: string;
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: { alg: number; type: "public-key" }[];
    timeout: number;
    attestation: "none" | "direct" | "indirect";
    authenticatorSelection: {
        authenticatorAttachment?: "platform" | "cross-platform";
        userVerification: "required" | "preferred" | "discouraged";
        requireResidentKey?: boolean;
    };
}

// Helper functions for ArrayBuffer <-> Base64
function bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

const nativeFingerprintBridge = (): any =>
    (window as any).ClicPOSNativePrinter || (window as any).AndroidPrinter || null;

const isSourceAfisCredential = (credential: UserBiometrics): boolean =>
    credential.publicKey?.startsWith('sourceafis:') === true;

export const biometricService = {
    /**
     * Check specifically for the supported external USB reader. This is kept
     * separate from platform WebAuthn so login screens can safely enable
     * passive listening without opening an operating-system biometric prompt.
     */
    isExternalReaderAvailable: async (): Promise<boolean> => {
        const nativeBridge = nativeFingerprintBridge();
        if (!nativeBridge?.discoverFingerprintReaders || !nativeBridge?.verifyFingerprintAsync) return false;

        try {
            const result = await nativeBridge.discoverFingerprintReaders({ connection: 'USB' });
            const devices = Array.isArray(result) ? result : (result?.devices || []);
            return devices.some((device: any) =>
                Number(device.vendorId) === 0x05ba && Number(device.productId) === 0x000a
            );
        } catch (error) {
            console.warn('External fingerprint availability check failed', error);
            return false;
        }
    },

    /**
     * Check if biometrics are available on this device
     */
    isAvailable: async (): Promise<boolean> => {
        const nativeBridge = nativeFingerprintBridge();
        if (nativeBridge?.discoverFingerprintReaders && nativeBridge?.enrollFingerprint && nativeBridge?.verifyFingerprint) {
            if (await biometricService.isExternalReaderAvailable()) return true;
        }

        if (!window.PublicKeyCredential) return false;
        try {
            return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        } catch (e) {
            console.error("Biometric availability check failed", e);
            return false;
        }
    },

    /**
     * Register a new biometric credential (Enrollment)
     */
    register: async (user: User): Promise<{ credentialID: string; publicKey: string } | null> => {
        try {
            const nativeBridge = nativeFingerprintBridge();
            if (nativeBridge?.enrollFingerprint) {
                const result = await nativeBridge.enrollFingerprint({ userId: user.id, userName: user.name });
                if (result?.success && result?.credentialID && result?.publicKey) {
                    return {
                        credentialID: String(result.credentialID),
                        publicKey: String(result.publicKey),
                    };
                }
                throw new Error(String(result?.message || 'No se pudo registrar la huella externa.'));
            }

            // Generate random challenge
            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);

            const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
                challenge,
                rp: {
                    name: "Alfa POS",
                    id: window.location.hostname, // Important: must match current domain
                },
                user: {
                    id: Uint8Array.from(user.id, c => c.charCodeAt(0)),
                    name: user.name,
                    displayName: user.name,
                },
                pubKeyCredParams: [
                    { alg: -7, type: "public-key" }, // ES256
                    { alg: -257, type: "public-key" } // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    userVerification: "preferred", // Change to preferred to avoid immediate exclusion on some devices
                },
                timeout: 60000,
                attestation: "none"
            };

            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions
            }) as PublicKeyCredential;

            if (!credential) return null;

            // In a real app, we would send this to backend. 
            // Here we store minimal data for local simulation or basic validation.
            const rawId = bufferToBase64(credential.rawId);

            return {
                credentialID: rawId,
                publicKey: 'stored_on_server_simulation' // Simplified for this demo
            };

        } catch (error) {
            console.error("Biometric registration failed", error);
            throw error;
        }
    },

    /**
     * Verify user identity (Login)
     * Supports multi-user identification by passing all allowed credential IDs
     */
    verify: async (credentials: UserBiometrics[]): Promise<string | null> => {
        try {
            const nativeCredentials = credentials.filter(isSourceAfisCredential);
            const nativeBridge = nativeFingerprintBridge();
            if (nativeCredentials.length > 0 && (nativeBridge?.verifyFingerprintAsync || nativeBridge?.verifyFingerprint)) {
                const payload = {
                    templates: nativeCredentials.map(credential => ({
                        credentialID: credential.credentialID,
                        publicKey: credential.publicKey,
                    })),
                };
                const result = nativeBridge.verifyFingerprintAsync
                    ? await nativeBridge.verifyFingerprintAsync(payload)
                    : await nativeBridge.verifyFingerprint(payload);
                return result?.success && result?.credentialID ? String(result.credentialID) : null;
            }

            const credentialIDs = credentials
                .filter(credential => !isSourceAfisCredential(credential))
                .map(credential => credential.credentialID);
            if (credentialIDs.length === 0) return null;

            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);

            const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
                challenge,
                allowCredentials: credentialIDs.map(id => ({
                    id: base64ToBuffer(id),
                    type: 'public-key',
                    transports: ['internal']
                })),
                rpId: window.location.hostname,
                userVerification: 'preferred',
                timeout: 60000,
            };

            const assertion = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions
            }) as PublicKeyCredential;

            if (assertion) {
                return bufferToBase64(assertion.rawId);
            }

            return null;
        } catch (error) {
            console.error("Biometric verification failed", error);
            return null;
        }
    }
};
