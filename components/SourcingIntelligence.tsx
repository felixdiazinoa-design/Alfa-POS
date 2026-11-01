
import React, { useState, useMemo } from 'react';
import {
    ChevronLeft, Download, Printer, Truck, Calendar, ShoppingBag,
    AlertTriangle, TrendingUp, Search, ChevronDown, ChevronUp,
    FileText, Package, Users, DollarSign, Clock, Receipt, ListChecks
} from 'lucide-react';
import { PurchaseOrder, Reception, Supplier, BusinessConfig, Product } from '../types';
import { formatSafeDate } from '../utils/dateUtils';
import { getSuppliersIntelligence, getItemPriceIntelligence, getDiscrepancyReport } from './AnalyticsLogic';

interface SourcingIntelligenceProps {
    purchaseOrders: PurchaseOrder[];
    receptions: Reception[];
    suppliers: Supplier[];
    products: Product[];
    config: BusinessConfig;
    onBack: () => void;
}

type SourcingTab = 'SUMMARY' | 'LOGISTICS' | 'PRICES' | 'DISCREPANCIES';

const SourcingIntelligence: React.FC<SourcingIntelligenceProps> = ({
    purchaseOrders,
    receptions,
    suppliers,
    products,
    config,
    onBack
}) => {
    const [activeTab, setActiveTab] = useState<SourcingTab>('SUMMARY');
    const [search, setSearch] = useState('');
    const [expandedPO, setExpandedPO] = useState<string | null>(null);

    // --- Calculated Data ---
    const supplierSummary = useMemo(() => getSuppliersIntelligence(purchaseOrders, suppliers), [purchaseOrders, suppliers]);
    const priceIntelligence = useMemo(() => getItemPriceIntelligence(purchaseOrders, suppliers), [purchaseOrders, suppliers]);
    const discrepancyReport = useMemo(() => getDiscrepancyReport(purchaseOrders, receptions, suppliers), [purchaseOrders, receptions, suppliers]);

    // --- KPIs ---
    const totalBoughtMonth = useMemo(() => {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        return purchaseOrders
            .filter(po => new Date(po.date) >= startOfMonth)
            .reduce((acc, po) => acc + (po.totalCost || 0), 0);
    }, [purchaseOrders]);

    const pendingOrders = purchaseOrders.filter(po => po.status !== 'COMPLETED').length;
    const inTransitValue = purchaseOrders
        .filter(po => po.status !== 'COMPLETED')
        .reduce((acc, po) => {
            const pendingValue = po.items.reduce((sum, item) => {
                const pending = Math.max(0, item.quantityOrdered - item.quantityReceived);
                return sum + (pending * item.cost);
            }, 0);
            return acc + pendingValue;
        }, 0);

    // --- Export ---
    const handleExport = () => {
        let headers = [];
        let rows = [];
        const filename = `analitica_proveedores_${activeTab.toLowerCase()}`;

        if (activeTab === 'SUMMARY') {
            headers = ['Proveedor', 'RNC', 'Cant. Órdenes', 'Total Comprado', 'Lead Time Prom'];
            rows = supplierSummary.map(s => [s.name, s.taxId, s.orderCount, s.totalSpent, s.avgLeadTime]);
        } else if (activeTab === 'PRICES') {
            headers = ['Artículo', 'Proveedor', 'Última Fecha', 'Precio Ant', 'Precio Nuevo', 'Var %'];
            rows = priceIntelligence.map(i => [i.name, i.lastSupplier, i.lastDate, i.prevPrice, i.lastPrice, i.variationPercent.toFixed(2)]);
        }

        const csvContent = "data:text/csv;charset=utf-8,"
            + headers.join(",") + "\n"
            + rows.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `${filename}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 animate-in fade-in duration-500">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-8 py-6 flex items-center justify-between no-print">
                <div className="flex items-center gap-6">
                    <button
                        onClick={onBack}
                        className="p-3 hover:bg-slate-100 rounded-2xl transition-all active:scale-90 text-slate-400 hover:text-slate-600"
                    >
                        <ChevronLeft size={24} />
                    </button>
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-sm">
                            <Truck size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-slate-800 tracking-tight">Inteligencia de Compras</h1>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Centro de Gestión de Proveedores y Costos</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button onClick={handleExport} className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-100 flex items-center gap-2 transition-all">
                        <Download size={16} /> Excel
                    </button>
                    <button onClick={() => window.print()} className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black shadow-lg shadow-slate-200 flex items-center gap-2 transition-all">
                        <Printer size={16} /> Imprimir
                    </button>
                </div>
            </div>

            {/* Filter & Tabs */}
            <div className="px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-6 no-print">
                <div className="flex bg-white p-1.5 rounded-[1.5rem] shadow-sm border border-slate-200 gap-1 w-full md:w-auto overflow-x-auto">
                    {[
                        { id: 'SUMMARY', label: 'Resumen', icon: TrendingUp },
                        { id: 'LOGISTICS', label: 'Logística', icon: Clock },
                        { id: 'PRICES', label: 'Precios', icon: DollarSign },
                        { id: 'DISCREPANCIES', label: 'Auditoría', icon: AlertTriangle },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as SourcingTab)}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100' : 'text-slate-400 hover:bg-slate-50'}`}
                        >
                            <tab.icon size={14} /> {tab.label}
                        </button>
                    ))}
                </div>

                <div className="relative w-full md:w-80">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Filtrar datos..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm font-medium text-slate-600"
                    />
                </div>
            </div>

            {/* Content Overflow */}
            <div className="flex-1 overflow-y-auto px-8 pb-12">
                {activeTab === 'SUMMARY' && (
                    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                        {/* KPIs */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="p-8 bg-white rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-8 text-emerald-50 opacity-10 group-hover:scale-110 transition-transform">
                                    <ShoppingBag size={80} />
                                </div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Comprado (Mes Actual)</p>
                                <p className="text-4xl font-black text-slate-800 tabular-nums">
                                    <span className="text-xl text-slate-300 mr-1">{config.currencySymbol}</span>
                                    {totalBoughtMonth.toLocaleString()}
                                </p>
                            </div>
                            <div className="p-8 bg-white rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden group">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Órdenes Pendientes</p>
                                <p className="text-4xl font-black text-emerald-600 tabular-nums">{pendingOrders}</p>
                                <p className="text-xs font-bold text-slate-400 mt-1 uppercase">Logística Activa</p>
                            </div>
                            <div className="p-8 bg-white rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden group">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Valorizado en Tránsito</p>
                                <p className="text-4xl font-black text-blue-600 tabular-nums">
                                    <span className="text-xl text-slate-300 mr-1">{config.currencySymbol}</span>
                                    {inTransitValue.toLocaleString()}
                                </p>
                            </div>
                        </div>

                        {/* Table */}
                        <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50/50">
                                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Proveedor</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">RNC</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Cant. Órdenes</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Monto Total</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Lead Time (Días)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {supplierSummary.filter(s => s.name.toLowerCase().includes(search.toLowerCase())).map((s, idx) => (
                                        <tr key={idx} className="border-t border-slate-50 hover:bg-slate-50/30 transition-colors group">
                                            <td className="px-8 py-5">
                                                <p className="font-black text-slate-700">{s.name}</p>
                                            </td>
                                            <td className="px-8 py-5 text-sm font-bold text-slate-400 select-all">{s.taxId}</td>
                                            <td className="px-8 py-5 text-center">
                                                <span className="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black text-slate-500 tabular-nums">{s.orderCount}</span>
                                            </td>
                                            <td className="px-8 py-5 text-right font-black text-slate-800 font-mono tracking-tighter tabular-nums">
                                                {config.currencySymbol}{s.totalSpent.toLocaleString()}
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <span className={`w-2 h-2 rounded-full ${s.avgLeadTime <= 3 ? 'bg-emerald-400' : s.avgLeadTime <= 7 ? 'bg-amber-400' : 'bg-rose-400'}`}></span>
                                                    <span className="font-bold text-slate-600 font-mono">{s.avgLeadTime}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'LOGISTICS' && (
                    <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
                        {purchaseOrders.filter(po => po.id.toLowerCase().includes(search.toLowerCase()) || po.supplierName?.toLowerCase().includes(search.toLowerCase())).map(po => (
                            <div key={po.id} className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden transition-all hover:border-emerald-200">
                                <div
                                    onClick={() => setExpandedPO(expandedPO === po.id ? null : po.id)}
                                    className="p-6 flex items-center justify-between cursor-pointer active:bg-slate-50 transition-colors"
                                >
                                    <div className="flex items-center gap-6">
                                        <div className="w-10 h-10 bg-slate-50 text-slate-400 rounded-xl flex items-center justify-center group-hover:text-emerald-500">
                                            <Receipt size={20} />
                                        </div>
                                        <div>
                                            <h4 className="font-black text-slate-800">#{po.id}</h4>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{po.supplierName}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-10">
                                        <div className="text-right">
                                            <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-0.5">Fecha</p>
                                            <p className="font-bold text-slate-600 text-sm">{formatSafeDate(po.date)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-0.5">Total</p>
                                            <p className="font-black text-slate-800 font-mono">{config.currencySymbol}{po.totalCost.toLocaleString()}</p>
                                        </div>
                                        <div className="px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600">
                                            {po.status}
                                        </div>
                                        {expandedPO === po.id ? <ChevronUp size={20} className="text-slate-300" /> : <ChevronDown size={20} className="text-slate-300" />}
                                    </div>
                                </div>

                                {expandedPO === po.id && (
                                    <div className="p-8 bg-slate-50/50 border-t border-slate-100 animate-in slide-in-from-top-2 duration-300">
                                        <div className="space-y-6">
                                            <div>
                                                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                    <Package size={12} /> Desglose de Artículos
                                                </h5>
                                                <table className="w-full text-left bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-200">
                                                    <thead>
                                                        <tr className="border-b border-slate-100 bg-slate-50/30">
                                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Artículo</th>
                                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Pedida</th>
                                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Recibida</th>
                                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Precio</th>
                                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Subtotal</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {po.items.map((item, iIdx) => (
                                                            <tr key={iIdx} className="border-b border-slate-50 last:border-0">
                                                                <td className="px-6 py-4 font-bold text-slate-700 text-sm">{item.productName}</td>
                                                                <td className="px-6 py-4 text-center font-mono font-bold text-slate-600">{item.quantityOrdered}</td>
                                                                <td className="px-6 py-4 text-center">
                                                                    <span className={`font-mono font-bold ${item.quantityReceived < item.quantityOrdered ? 'text-rose-500' : 'text-emerald-500'}`}>
                                                                        {item.quantityReceived}
                                                                    </span>
                                                                </td>
                                                                <td className="px-6 py-4 text-right font-mono text-slate-600">{config.currencySymbol}{item.cost.toLocaleString()}</td>
                                                                <td className="px-6 py-4 text-right font-black text-slate-800 font-mono">
                                                                    {config.currencySymbol}{(item.quantityOrdered * item.cost).toLocaleString()}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                            <div>
                                                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                    <Clock size={12} /> Historial de Recepciones
                                                </h5>
                                                <div className="flex flex-col gap-2">
                                                    {receptions.filter(r => r.purchaseOrderId === po.id).map((r, rIdx) => (
                                                        <div key={rIdx} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-200">
                                                            <div className="flex items-center gap-4">
                                                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                                                                    <Truck size={14} />
                                                                </div>
                                                                <div>
                                                                    <p className="text-sm font-bold text-slate-700">{formatSafeDate(r.date)}</p>
                                                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Recibido por: {r.receivedByUserName}</p>
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                                                                    {r.items.reduce((acc, i) => acc + i.quantityReceived, 0)} Unidades Entradas
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {receptions.filter(r => r.purchaseOrderId === po.id).length === 0 && (
                                                        <p className="text-xs font-bold text-slate-400 italic">No hay registros de recepción física para esta orden.</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'PRICES' && (
                    <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50">
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Artículo</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Último Proveedor</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Última Fecha</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Precio Ant.</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Precio Actual</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Variación</th>
                                </tr>
                            </thead>
                            <tbody>
                                {priceIntelligence.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).map((i, idx) => (
                                    <tr key={idx} className="border-t border-slate-50 hover:bg-slate-50/30 transition-colors">
                                        <td className="px-8 py-5 font-black text-slate-700">{i.name}</td>
                                        <td className="px-8 py-5 font-bold text-slate-500 text-sm">{i.lastSupplier}</td>
                                        <td className="px-8 py-5 font-bold text-slate-400 text-xs">{formatSafeDate(i.lastDate)}</td>
                                        <td className="px-8 py-5 text-right font-mono text-slate-400">{config.currencySymbol}{i.prevPrice.toLocaleString()}</td>
                                        <td className={`px-8 py-5 text-right font-mono font-black ${i.isAlert ? 'bg-orange-50 text-orange-600 animate-pulse' : 'text-slate-800'}`}>
                                            {config.currencySymbol}{i.lastPrice.toLocaleString()}
                                        </td>
                                        <td className={`px-8 py-5 text-right font-mono font-black ${i.variationPercent > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                            {i.variationPercent > 0 ? '+' : ''}{i.variationPercent.toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeTab === 'DISCREPANCIES' && (
                    <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50">
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Orden #</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Artículo</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Pedido</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center text-rose-500">Recibido</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Faltante</th>
                                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Motivo Ajuste</th>
                                </tr>
                            </thead>
                            <tbody>
                                {discrepancyReport.map((d, idx) => (
                                    <tr key={idx} className="border-t border-slate-50 hover:bg-rose-50/20 transition-colors">
                                        <td className="px-8 py-5 font-black text-slate-800">#{d.poId}</td>
                                        <td className="px-8 py-5 font-bold text-slate-700">{d.productName}</td>
                                        <td className="px-8 py-5 text-center font-mono font-bold text-slate-400">{d.ordered}</td>
                                        <td className="px-8 py-5 text-center font-mono font-black text-rose-500">{d.received}</td>
                                        <td className="px-8 py-5 text-center">
                                            <span className="px-3 py-1 bg-rose-100 text-rose-700 rounded-full font-mono font-black text-xs">{d.missing}</span>
                                        </td>
                                        <td className="px-8 py-5">
                                            <span className="text-xs font-bold text-slate-400 italic">Discrepancia en recepción física</span>
                                        </td>
                                    </tr>
                                ))}
                                {discrepancyReport.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-8 py-20 text-center">
                                            <div className="flex flex-col items-center gap-3">
                                                <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center">
                                                    <ListChecks size={32} />
                                                </div>
                                                <p className="font-black text-slate-400 uppercase tracking-widest text-xs">Sin discrepancias detectadas</p>
                                                <p className="text-slate-300 text-xs">Todas las recepciones coinciden con lo pedido.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SourcingIntelligence;
