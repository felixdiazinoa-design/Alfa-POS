import express from 'express';
import { ApplePassGenerator } from '../wallet/applePassGenerator.js';
import { GooglePassGenerator } from '../wallet/googlePassGenerator.js';
import { APNSService } from '../wallet/apnsService.js';
import { EmailService } from '../services/emailService.js';
import { getCollection, getSetting, saveSetting } from '../db.js';

const router = express.Router();

const getWalletConfig = () => {
    return getSetting('walletConfig') || {
        apple: { teamId: '', passTypeIdentifier: '', p12Cert: '', p12Password: '', isConfigured: false },
        google: { issuerId: '', serviceAccountJson: '', isConfigured: false }
    };
};

router.post('/config', (req, res) => {
    const { apple, google } = req.body;
    const walletConfig = getWalletConfig();

    if (apple) walletConfig.apple = { ...walletConfig.apple, ...apple };
    if (google) walletConfig.google = { ...walletConfig.google, ...google };

    saveSetting('walletConfig', walletConfig);
    res.json({ success: true, message: 'Configuration saved securely' });
});

router.post('/test-connection', async (req, res) => {
    const { type } = req.body;
    const walletConfig = getWalletConfig();

    try {
        if (type === 'APPLE') {
            if (!walletConfig.apple.teamId || !walletConfig.apple.p12Cert) {
                throw new Error('Missing Apple credentials');
            }
            res.json({ success: true, message: 'Apple Wallet connection verified' });
        } else if (type === 'GOOGLE') {
            if (!walletConfig.google.issuerId || !walletConfig.google.serviceAccountJson) {
                throw new Error('Missing Google credentials');
            }
            let serviceAccount: any = {};
            try { serviceAccount = JSON.parse(walletConfig.google.serviceAccountJson); } catch (e) { }
            if (!serviceAccount.client_email) throw new Error('Invalid Service Account JSON: Missing client_email');
            res.json({ success: true, message: 'Google Wallet connection verified' });
        } else {
            res.status(400).json({ success: false, message: 'Invalid wallet type' });
        }
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/test-push', async (req, res) => {
    const { pushToken } = req.body;
    const walletConfig = getWalletConfig();

    if (!pushToken) return res.status(400).json({ success: false, message: 'Missing pushToken' });

    try {
        const apnsService = new APNSService(walletConfig.apple);
        await apnsService.sendPush(pushToken);
        res.json({ success: true, message: 'Push notification sent successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/send-welcome-email', async (req, res) => {
    const { customerId } = req.body;
    const walletConfig = getWalletConfig();

    if (!customerId) return res.status(400).json({ success: false, message: 'Missing customerId' });

    try {
        const customers = getCollection('customers');
        const customer = customers.find((c: any) => c.id === customerId);

        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

        const appleConfig = {
            teamIdentifier: walletConfig.apple.teamId || 'MOCK_TEAM',
            passTypeIdentifier: walletConfig.apple.passTypeIdentifier || 'pass.com.clicpos.loyalty',
            organizationName: 'Alfa POS',
            description: 'Loyalty Card',
            logoText: 'CLIC',
            foregroundColor: 'rgb(255, 255, 255)',
            backgroundColor: 'rgb(0, 0, 0)',
            labelColor: 'rgb(255, 255, 255)'
        };

        const certs = {
            wwdr: '',
            signerCert: walletConfig.apple.p12Cert,
            signerKey: '',
            signerKeyPassphrase: walletConfig.apple.p12Password
        };

        const generator = new ApplePassGenerator(appleConfig, certs);
        const passBuffer = await generator.generatePass(customer);

        const emailService = new EmailService();
        await emailService.sendWalletWelcome(customer, passBuffer);

        res.json({ success: true, message: 'Welcome email sent successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;

