import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, AlertTriangle, Calculator, Package, ChefHat, Search, Info, Wand2 } from 'lucide-react';
import { Product, RecipeDetail, ProductType } from '../types';
import { UNITS, calculateCost, UnitType } from '../utils/units';
import { calculatePriceFromMargin } from '../utils/pricing';

const formatCurrency = (amount: number, symbol: string = '$'): string => {
    return new Intl.NumberFormat('es-DO', {
        style: 'currency',
        currency: 'DOP',
        minimumFractionDigits: 2
    }).format(amount).replace('DOP', symbol).trim();
};

interface RecipeManagerProps {
    product: Product;
    allProducts: Product[]; // For ingredient search
    onUpdate: (updates: Partial<Product>) => void;
    currencySymbol: string;
}

const RecipeManager: React.FC<RecipeManagerProps> = ({ product, allProducts, onUpdate, currencySymbol }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<Product[]>([]);

    const recipeType = product.type === 'KIT' ? 'KIT' : 'RECETA';

    useEffect(() => {
        if (searchTerm.length > 1) {
            const results = allProducts.filter(p =>
                p.id !== product.id && // Prevent circular dependency (simple check)
                p.name.toLowerCase().includes(searchTerm.toLowerCase())
            ).slice(0, 5);
            setSearchResults(results);
        } else {
            setSearchResults([]);
        }
    }, [searchTerm, allProducts, product.id]);

    const handleAddIngredient = (ingredient: Product) => {
        // Try to infer purchasing unit from attributes or defaults
        const purchaseUnit = ingredient.purchaseUnit || ingredient.attributes?.find(a => a.name === 'Unidad')?.options[0] || 'un';

        const newDetail: RecipeDetail = {
            id: crypto.randomUUID(), // Temp ID
            parentItemId: product.id,
            childItemId: ingredient.id,
            childItemName: ingredient.name,
            quantity: 1,
            unit: purchaseUnit,
            originalUnit: purchaseUnit,
            wasteFactor: 0,
            isOptional: false,
            cost: ingredient.cost || 0
        };

        const currentDetails = product.recipeDetails || [];
        onUpdate({ recipeDetails: [...currentDetails, newDetail] });
        setSearchTerm('');
    };

    const handleRemoveIngredient = (id: string) => {
        const currentDetails = product.recipeDetails || [];
        onUpdate({ recipeDetails: currentDetails.filter(d => d.id !== id) });
    };

    const handleUpdateDetail = (id: string, field: keyof RecipeDetail, value: any) => {
        const currentDetails = product.recipeDetails || [];
        onUpdate({
            recipeDetails: currentDetails.map(d =>
                d.id === id ? { ...d, [field]: value } : d
            )
        });
    };

    // Calculations
    const totalIngredientsCost = useMemo(() => {
        return (product.recipeDetails || []).reduce((sum, detail) => {
            const ing = allProducts.find(p => p.id === detail.childItemId);
            const baseCost = ing?.cost || 0;
            const purchaseUnit = detail.originalUnit || ing?.purchaseUnit || 'un';

            // Calculate cost based on Unit Conversion
            const convertedCost = calculateCost(detail.quantity, detail.unit, baseCost, purchaseUnit);

            let waste = parseFloat(detail.wasteFactor.toString());
            if (isNaN(waste) || waste >= 1) waste = 0;

            const finalCost = convertedCost / (1 - waste);
            return sum + finalCost;
        }, 0);
    }, [product.recipeDetails, allProducts]);

    const batchYield = product.batchYield || 1;
    const unitCost = totalIngredientsCost / batchYield;

    const foodCostPct = product.price > 0 ? (unitCost / product.price) * 100 : 0;

    // Sync cost to parent product theoretical cost
    useEffect(() => {
        if (Math.abs((product.theoreticalCost || 0) - unitCost) > 0.01) {
            onUpdate({ theoreticalCost: unitCost });
        }
    }, [unitCost]);

    // Helper to get compatible units for a selector
    const getCompatibleUnits = (baseUnitCode: string) => {
        const baseUnit = UNITS[baseUnitCode];
        if (!baseUnit) return [UNITS['un']]; // Fallback
        return Object.values(UNITS).filter(u => u.type === baseUnit.type);
    };

    // Smart Price Adjustment State
    const [showPricePopover, setShowPricePopover] = useState(false);
    const [targetMargin, setTargetMargin] = useState<string>('30'); // Default to 30%

    const handleApplyMargin = (percentage: number) => {
        const newPrice = calculatePriceFromMargin(unitCost, percentage);
        onUpdate({ price: newPrice });
        setShowPricePopover(false);
    };

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* Header / Type Selector */}
            <div className="flex flex-col md:flex-row gap-6 p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex-1">
                    <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        {recipeType === 'RECETA' ? <ChefHat size={20} className="text-orange-500" /> : <Package size={20} className="text-blue-500" />}
                        Composición del Producto
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                        {recipeType === 'RECETA'
                            ? "Define los ingredientes y mermas para calcular el costo de producción."
                            : "Agrupa productos para venderlos como un combo (Kit / Bundle)."}
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    {/* BATCH YIELD INPUT */}
                    {recipeType === 'RECETA' && (
                        <div className="bg-white p-2 rounded-xl border border-orange-200 flex flex-col items-center min-w-[100px]">
                            <label className="text-[10px] font-black text-orange-400 uppercase tracking-wide mb-1">Rendimiento</label>
                            <div className="flex items-baseline gap-1">
                                <input
                                    type="number"
                                    min="1"
                                    value={product.batchYield || 1}
                                    onChange={(e) => onUpdate({ batchYield: parseFloat(e.target.value) || 1 })}
                                    className="w-12 text-center font-black text-lg text-slate-800 outline-none border-b border-transparent focus:border-orange-300"
                                />
                                <span className="text-[10px] font-bold text-slate-400">unids.</span>
                            </div>
                        </div>
                    )}

                    <div className="flex bg-white p-1 rounded-xl border border-slate-200 h-fit">
                        <button
                            onClick={() => onUpdate({ type: 'RECETA' })}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${product.type === 'RECETA' ? 'bg-orange-100 text-orange-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <ChefHat size={16} /> Receta
                        </button>
                        <button
                            onClick={() => onUpdate({ type: 'KIT' })}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${product.type === 'KIT' ? 'bg-blue-100 text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <Package size={16} /> Kit
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
                {/* Left: Ingredients List */}
                <div className="flex-1 space-y-4">
                    {/* ... (ingredients list content) */}
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar ingrediente o producto..."
                            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-blue-100 outline-none"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        {searchResults.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden">
                                {searchResults.map(res => (
                                    <button
                                        key={res.id}
                                        onClick={() => handleAddIngredient(res)}
                                        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex justify-between items-center group border-b border-slate-100 last:border-0"
                                    >
                                        <div>
                                            <div className="font-bold text-slate-700">{res.name}</div>
                                            <div className="text-xs text-slate-400">Costo: {formatCurrency(res.cost || 0, currencySymbol)}</div>
                                        </div>
                                        <Plus size={18} className="text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* List */}
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                <tr>
                                    <th className="px-4 py-3">Ingrediente</th>
                                    <th className="px-4 py-3 text-center">Cant. / Unidad</th>
                                    {recipeType === 'RECETA' && <th className="px-4 py-3 text-center">Merma %</th>}
                                    <th className="px-4 py-3 text-right">Costo Est.</th>
                                    <th className="px-4 py-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {(product.recipeDetails || []).map((detail, idx) => {
                                    const ing = allProducts.find(p => p.id === detail.childItemId);
                                    const baseCost = ing?.cost || 0;
                                    const purchaseUnit = detail.originalUnit || ing?.purchaseUnit || 'un';

                                    // Calculate for display
                                    const convertedCost = calculateCost(detail.quantity, detail.unit, baseCost, purchaseUnit);
                                    const waste = detail.wasteFactor || 0;
                                    const realCost = convertedCost / (1 - waste);

                                    const compatibleUnits = getCompatibleUnits(purchaseUnit);

                                    return (
                                        <tr key={detail.id || idx} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-slate-700 text-sm">{detail.childItemName || ing?.name || '---'}</div>
                                                <div className="text-[10px] text-slate-400">
                                                    {formatCurrency(baseCost, currencySymbol)} / {UNITS[purchaseUnit]?.name || purchaseUnit}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.001"
                                                        value={detail.quantity}
                                                        onChange={(e) => handleUpdateDetail(detail.id, 'quantity', parseFloat(e.target.value))}
                                                        className="w-16 text-center font-bold bg-slate-100 rounded-lg py-1 text-sm border-transparent focus:bg-white focus:border-blue-300 outline-none border transition-all"
                                                    />
                                                    <select
                                                        value={detail.unit}
                                                        onChange={(e) => handleUpdateDetail(detail.id, 'unit', e.target.value)}
                                                        className="w-24 text-xs font-bold bg-slate-100 rounded-lg py-1 border-transparent focus:bg-white focus:border-blue-300 outline-none border transition-all"
                                                    >
                                                        {compatibleUnits.map(u => (
                                                            <option key={u.code} value={u.code}>{u.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </td>
                                            {recipeType === 'RECETA' && (
                                                <td className="px-4 py-3 text-center">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="99"
                                                        value={(detail.wasteFactor * 100).toFixed(0)}
                                                        onChange={(e) => handleUpdateDetail(detail.id, 'wasteFactor', parseFloat(e.target.value) / 100)}
                                                        className="w-16 text-center font-bold bg-slate-100 rounded-lg py-1 text-sm border-transparent focus:bg-white focus:border-blue-300 outline-none border transition-all"
                                                    />
                                                    <span className="text-xs text-slate-400 ml-1">%</span>
                                                </td>
                                            )}
                                            <td className="px-4 py-3 text-right text-sm font-mono text-slate-600">
                                                {formatCurrency(realCost, currencySymbol)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button
                                                    onClick={() => handleRemoveIngredient(detail.id)}
                                                    className="p-2 text-slate-300 hover:text-red-500 transition-colors rounded-full hover:bg-red-50"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {(product.recipeDetails?.length === 0) && (
                                    <tr>
                                        <td colSpan={5} className="p-8 text-center text-slate-400 italic text-sm">
                                            Agrega ingredientes usando el buscador superior.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Right: Cost Summary */}
                <div className="lg:w-80 shrink-0 space-y-6">
                    <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl relative overflow-visible">

                        {/* Dynamic color warning bg */}
                        {foodCostPct > 35 && (
                            <div className="absolute top-0 right-0 w-32 h-32 bg-red-500 rounded-full blur-[60px] opacity-20 pointer-events-none"></div>
                        )}

                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Calculator size={14} /> Análisis de Costo
                        </h4>

                        <div className="space-y-4 mb-6">
                            <div className="flex justify-between items-end border-b border-slate-700 pb-2">
                                <span className="text-slate-400 text-sm">Costo Ingredientes</span>
                                <span className="text-lg font-bold text-slate-300">{formatCurrency(totalIngredientsCost, currencySymbol)}</span>
                            </div>
                            {batchYield > 1 && (
                                <div className="flex justify-between items-end border-b border-slate-700 pb-2">
                                    <span className="text-orange-400 text-sm">Yield Divider</span>
                                    <span className="text-sm font-bold text-orange-400">÷ {batchYield}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-end border-b border-slate-700 pb-2">
                                <span className="text-slate-100 text-sm font-bold">Costo Unitario</span>
                                <span className="text-2xl font-black">{formatCurrency(unitCost, currencySymbol)}</span>
                            </div>
                            <div className="flex justify-between items-end pb-2 relative">
                                <span className="text-slate-400 text-sm flex items-center gap-2">
                                    Precio Venta
                                    <button
                                        onClick={() => setShowPricePopover(!showPricePopover)}
                                        className="flex items-center gap-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg px-2 py-1 transition-all group"
                                        title="Ajuste Inteligente de Precio"
                                    >
                                        <Wand2 size={12} className="text-blue-300 group-hover:text-blue-200" />
                                        <span className="text-[10px] font-bold text-blue-300 group-hover:text-blue-200 uppercase tracking-wide">Ajustar</span>
                                    </button>
                                </span>
                                <span className="text-xl font-bold text-slate-300">{formatCurrency(product.price, currencySymbol)}</span>

                                {/* Smart Price Adjustment Popover */}
                                {showPricePopover && (
                                    <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-2xl p-4 w-64 z-[100] border border-slate-200 animate-in fade-in zoom-in-95 origin-top-right text-slate-800">
                                        <div className="flex justify-between items-center mb-3">
                                            <h5 className="font-bold text-xs uppercase text-slate-500">Ajuste Inteligente</h5>
                                            <button onClick={() => setShowPricePopover(false)} className="text-slate-400 hover:text-slate-600"><Plus size={16} className="rotate-45" /></button>
                                        </div>

                                        <div className="space-y-3">
                                            <button
                                                onClick={() => handleApplyMargin(30)}
                                                className="w-full py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-sm font-bold border border-emerald-100 transition-colors"
                                            >
                                                Aplicar Food Cost 30%
                                            </button>

                                            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                                                <div className="relative flex-1">
                                                    <input
                                                        type="number"
                                                        value={targetMargin}
                                                        onChange={(e) => setTargetMargin(e.target.value)}
                                                        className="w-full pl-2 pr-8 py-1.5 bg-slate-50 rounded-lg text-sm font-bold border border-slate-200 outline-none focus:border-blue-300"
                                                        placeholder="40"
                                                    />
                                                    <span className="absolute right-2 top-1.5 text-xs text-slate-400 font-bold">%</span>
                                                </div>
                                                <button
                                                    onClick={() => handleApplyMargin(parseFloat(targetMargin) || 30)}
                                                    className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-bold transition-colors"
                                                >
                                                    Ok
                                                </button>
                                            </div>

                                            <div className="text-[10px] text-center text-slate-400 mt-1">
                                                Sugerido: <span className="font-mono font-bold text-slate-600">{formatCurrency(calculatePriceFromMargin(unitCost, parseFloat(targetMargin) || 30), currencySymbol)}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={`p-4 rounded-xl border flex items-center justify-between ${foodCostPct > 35
                            ? 'bg-red-500/10 border-red-500/30 text-red-400'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            }`}>
                            <div>
                                <div className="text-xs font-bold uppercase mb-0.5">Food Cost</div>
                                <div className="text-2xl font-black">{foodCostPct.toFixed(1)}%</div>
                            </div>
                            {foodCostPct > 35 && <AlertTriangle size={24} />}
                        </div>

                        {foodCostPct > 35 && (
                            <p className="text-[10px] text-red-300 mt-3 leading-relaxed">
                                ⚠️ El costo supera el 35% del precio de venta. Considera ajustar la receta o subir el precio.
                            </p>
                        )}
                    </div>
    // ...

                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                        <h5 className="font-bold text-blue-800 text-sm mb-2 flex items-center gap-2">
                            <Info size={16} /> Nota
                        </h5>
                        <p className="text-xs text-blue-600 leading-relaxed">
                            Al realizar una venta de este porducto, el inventario se descontará automáticamente de los ingredientes listados aquí.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RecipeManager;

