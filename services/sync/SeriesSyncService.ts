import { DocumentSeries } from '../../types';
import { db } from '../../utils/db';

/**
 * Service for synchronizing document series across terminals using localStorage events
 */
class SeriesSyncService {
    private readonly STORAGE_KEY = 'CLIC_POS_SERIES_SYNC';

    constructor() {
        this.initializeListener();
    }

    /**
     * Initialize localStorage event listener for cross-tab communication
     */
    private initializeListener() {
        window.addEventListener('storage', async (event) => {
            if (event.key === this.STORAGE_KEY && event.newValue) {
                try {
                    const syncData = JSON.parse(event.newValue);
                    await this.handleIncomingSync(syncData);
                } catch (error) {
                    console.error('Error handling series sync:', error);
                }
            }
        });

        console.log('📡 Series Sync Service initialized');
    }

    /**
     * Broadcast series change to all other terminals
     */
    async broadcastChange(action: 'CREATE' | 'UPDATE' | 'DELETE', series: DocumentSeries | string) {
        const syncData = {
            action,
            series,
            timestamp: Date.now(),
            sourceTerminal: this.getCurrentTerminalId()
        };

        // Use localStorage to broadcast to other tabs/windows
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(syncData));

        // Clear immediately to allow same change to be broadcast again if needed
        setTimeout(() => {
            const current = localStorage.getItem(this.STORAGE_KEY);
            if (current === JSON.stringify(syncData)) {
                localStorage.removeItem(this.STORAGE_KEY);
            }
        }, 100);

        console.log(`📤 Broadcasting ${action} for series:`, series);
    }

    /**
     * Handle incoming sync from another terminal
     */
    private async handleIncomingSync(syncData: any) {
        const { action, series, sourceTerminal } = syncData;

        // Don't process our own broadcasts
        if (sourceTerminal === this.getCurrentTerminalId()) {
            return;
        }

        console.log(`📥 Received ${action} from terminal ${sourceTerminal}`);

        try {
            const sequences = await db.get('internalSequences') as DocumentSeries[] || [];

            switch (action) {
                case 'CREATE':
                case 'UPDATE': {
                    const existingIndex = sequences.findIndex(s => s.id === series.id);
                    if (existingIndex >= 0) {
                        sequences[existingIndex] = series;
                        console.log(`✏️ Updated series: ${series.id}`);
                    } else {
                        sequences.push(series);
                        console.log(`➕ Added series: ${series.id}`);
                    }
                    break;
                }

                case 'DELETE': {
                    const deleteIndex = sequences.findIndex(s => s.id === series);
                    if (deleteIndex >= 0) {
                        sequences.splice(deleteIndex, 1);
                        console.log(`🗑️ Deleted series: ${series}`);
                    }
                    break;
                }
            }

            await db.save('internalSequences', sequences);

            // Trigger a custom event to notify components to refresh
            window.dispatchEvent(new CustomEvent('seriesUpdated'));

        } catch (error) {
            console.error('Error applying series sync:', error);
        }
    }

    /**
     * Get current terminal ID from localStorage or generate one
     */
    private getCurrentTerminalId(): string {
        let terminalId = localStorage.getItem('CLIC_POS_TERMINAL_ID');
        if (!terminalId) {
            terminalId = `TERM-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            localStorage.setItem('CLIC_POS_TERMINAL_ID', terminalId);
        }
        return terminalId;
    }
}

export const seriesSyncService = new SeriesSyncService();
