import express from 'express';
import { getCollection, getSetting, saveSetting } from '../db.js';
import { ApplePassGenerator } from '../wallet/applePassGenerator.js';

const router = express.Router();

// Helper to get registrations collection
const getRegistrations = () => {
    return getSetting('passRegistrations') || [];
};

// 1. Register Device
router.post('/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', (req, res) => {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
    const { pushToken } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('ApplePass')) {
        return res.status(401).send();
    }

    const registrations = getRegistrations();
    const existing = registrations.find((r: any) =>
        r.deviceLibraryIdentifier === deviceLibraryIdentifier &&
        r.serialNumber === serialNumber
    );

    if (!existing) {
        registrations.push({
            deviceLibraryIdentifier,
            passTypeIdentifier,
            serialNumber,
            pushToken,
            updatedAt: new Date().toISOString()
        });
        saveSetting('passRegistrations', registrations);
    }

    res.status(201).send();
});

// 2. Get Serial Numbers for Updatable Passes
router.get('/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier', (req, res) => {
    const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
    const registrations = getRegistrations();

    const devicePasses = registrations.filter((r: any) =>
        r.deviceLibraryIdentifier === deviceLibraryIdentifier &&
        r.passTypeIdentifier === passTypeIdentifier
    );

    if (devicePasses.length === 0) {
        return res.status(204).send();
    }

    const serialNumbers = devicePasses.map((r: any) => r.serialNumber);

    res.json({
        lastUpdated: new Date().toISOString(),
        serialNumbers: serialNumbers
    });
});

// 3. Get Latest Pass
router.get('/passes/:passTypeIdentifier/:serialNumber', async (req, res) => {
    const { passTypeIdentifier, serialNumber } = req.params;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('ApplePass')) {
        return res.status(401).send();
    }

    try {
        const customers = getCollection('customers');
        const customer = customers.find((c: any) => c.id === serialNumber);

        if (!customer) return res.status(404).send();

        const walletConfig = getSetting('walletConfig') || {};
        const appleConfig = {
            teamIdentifier: walletConfig.apple?.teamId || 'MOCK_TEAM_ID',
            passTypeIdentifier: passTypeIdentifier,
            organizationName: 'Alfa POS',
            description: 'Loyalty Card',
            logoText: 'CLIC',
            foregroundColor: 'rgb(255, 255, 255)',
            backgroundColor: 'rgb(0, 0, 0)',
            labelColor: 'rgb(255, 255, 255)'
        };

        const certs = {
            wwdr: '',
            signerCert: walletConfig.apple?.p12Cert || '',
            signerKey: '',
            signerKeyPassphrase: walletConfig.apple?.p12Password || ''
        };

        const generator = new ApplePassGenerator(appleConfig, certs);
        const passBuffer = await generator.generatePass(customer);

        res.set('Content-Type', 'application/vnd.apple.pkpass');
        res.set('last-modified', new Date().toISOString());
        res.send(passBuffer);
    } catch (error) {
        res.status(500).send();
    }
});

// 4. Unregister Device
router.delete('/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', (req, res) => {
    const { deviceLibraryIdentifier, serialNumber } = req.params;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('ApplePass')) {
        return res.status(401).send();
    }

    let registrations = getRegistrations();
    registrations = registrations.filter((r: any) =>
        !(r.deviceLibraryIdentifier === deviceLibraryIdentifier && r.serialNumber === serialNumber)
    );

    saveSetting('passRegistrations', registrations);
    res.status(200).send();
});

// 5. Log Error
router.post('/log', (req, res) => {
    console.error('[PassKit] Client Log:', req.body);
    res.status(200).send();
});

export default router;

