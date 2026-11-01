import React, { useState, useEffect, useRef } from 'react';
import { X, ArrowRight, ArrowLeft, Check, AlertCircle, Split, GripVertical, MoveRight } from 'lucide-react';
import { CartItem } from '../types';

interface SplitTicketModalProps {
  originalItems: CartItem[];
  currencySymbol: string;
  onClose: () => void;
  onConfirm: (remainingItems: CartItem[], newTicketItems: CartItem[]) => void;
}

const NumberTicker: React.FC<{ value: number; currency: string }> = ({ value, currency }) => {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    const start = displayValue;
    const end = value;
    if (start === end) return;
    const duration = 500; 
    const startTime = performance.now();
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4);
      const current = start + (end - start) * ease;
      setDisplayValue(current);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);

  return <span className="tabular-nums tracking-tight">{currency}{displayValue.toFixed(2)}</span>;
};

const SplitTicketModal: React.FC<SplitTicketModalProps> = ({ originalItems, currencySymbol, onClose, onConfirm }) => {
  const [leftItems, setLeftItems] = useState<CartItem[]>([]);
  const [rightItems, setRightItems] = useState<CartItem[]>([]);
  const [dragOverSide, setDragOverSide] = useState<'LEFT' | 'RIGHT' | null>(null);
  const [qtyModal, setQtyModal] = useState<{ isOpen: boolean; item: CartItem | null; sourceSide: 'LEFT' | 'RIGHT' }>({ isOpen: false, item: null, sourceSide: 'LEFT' });
  const [sliderValue, setSliderValue] = useState(1);

  useEffect(() => { setLeftItems(JSON.parse(JSON.stringify(originalItems))); }, [originalItems]);

  const calculateTotal = (items: CartItem[]) => items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const leftTotal = calculateTotal(leftItems);
  const rightTotal = calculateTotal(rightItems);

  const transferItem = (itemToMove: CartItem, sourceSide: 'LEFT' | 'RIGHT', quantityToMove: number) => {
    const setSource = sourceSide === 'LEFT' ? setLeftItems : setRightItems;
    const setTarget = sourceSide === 'LEFT' ? setRightItems : setLeftItems;
    setSource(prev => {
      const newList = [...prev];
      const index = newList.findIndex(i => i.cartId === itemToMove.cartId);
      if (index === -1) return prev;
      if (newList[index].quantity === quantityToMove) newList.splice(index, 1);
      else newList[index] = { ...newList[index], quantity: newList[index].quantity - quantityToMove };
      return newList;
    });
    setTarget(prev => {
      const newList = [...prev];
      const existingIndex = newList.findIndex(i => i.id === itemToMove.id && i.price === itemToMove.price && JSON.stringify(i.modifiers) === JSON.stringify(itemToMove.modifiers));
      if (existingIndex > -1) newList[existingIndex] = { ...newList[existingIndex], quantity: newList[existingIndex].quantity + quantityToMove };
      else newList.push({ ...itemToMove, cartId: Math.random().toString(36).substr(2, 9), quantity: quantityToMove });
      return newList;
    });
  };

  const handleDragStart = (e: React.DragEvent, item: CartItem, sourceSide: 'LEFT' | 'RIGHT') => {
    e.dataTransfer.setData('application/json', JSON.stringify({ item, sourceSide }));
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent, side: 'LEFT' | 'RIGHT') => { e.preventDefault(); setDragOverSide(side); };
  const handleDrop = (e: React.DragEvent, targetSide: 'LEFT' | 'RIGHT') => {
    e.preventDefault();
    setDragOverSide(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      const item = data.item as CartItem;
      const sourceSide = data.sourceSide as 'LEFT' | 'RIGHT';
      if (sourceSide === targetSide) return;
      if (item.quantity > 1) { setSliderValue(1); setQtyModal({ isOpen: true, item, sourceSide }); }
      else transferItem(item, sourceSide, 1);
    } catch (err) { console.error("Drop failed", err); }
  };
  const handleItemClick = (item: CartItem, sourceSide: 'LEFT' | 'RIGHT') => {
    if (item.quantity > 1) { setSliderValue(1); setQtyModal({ isOpen: true, item, sourceSide }); }
    else transferItem(item, sourceSide, 1);
  };

  const confirmQtyMove = () => { if (qtyModal.item) { transferItem(qtyModal.item, qtyModal.sourceSide, sliderValue); setQtyModal({ ...qtyModal, isOpen: false }); } };

  return (
    <div className="fixed inset-0 z-[80] bg-gray-900/95 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-7xl h-[90vh] flex flex-col relative">
        <div className="flex justify-between items-center mb-6 text-white">
           <div className="flex items-center gap-4"><div className="bg-orange-500 p-3 rounded-2xl shadow-lg shadow-orange-500/20"><Split size={28} className="text-white" /></div><div><h1 className="text-3xl font-black tracking-tight">Dividir Cuenta</h1><p className="text-white/60 font-medium">Arrastra items o toca para moverlos</p></div></div>
           <button onClick={onClose} className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"><X size={24} /></button>
        </div>
        <div className="flex-1 flex gap-6 overflow-hidden">
           <div onDragOver={(e) => handleDragOver(e, 'LEFT')} onDrop={(e) => handleDrop(e, 'LEFT')} className={`flex-1 rounded-[2.5rem] p-6 flex flex-col transition-all duration-300 border-4 ${dragOverSide === 'LEFT' ? 'bg-blue-600/20 border-blue-400 scale-[1.02] shadow-[0_0_50px_rgba(59,130,246,0.3)]' : 'bg-white border-white/10 shadow-2xl'}`}>
              <div className="flex justify-between items-end mb-6 pb-4 border-b border-gray-100"><div><span className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Origen</span><h2 className="text-xl font-bold text-gray-800">Cuenta Original</h2></div><div className="text-3xl font-black text-blue-600"><NumberTicker value={leftTotal} currency={currencySymbol} /></div></div>
              <div className="flex-1 overflow-y-auto space-y-3 pr-2">{leftItems.length === 0 && (<div className="h-full flex flex-col items-center justify-center opacity-30 text-gray-500"><AlertCircle size={48} className="mb-2" /><p className="font-bold">Todo movido</p></div>)}{leftItems.map(item => (<DraggableCard key={item.cartId} item={item} side="LEFT" currencySymbol={currencySymbol} onDragStart={handleDragStart} onClick={handleItemClick} />))}</div>
           </div>
           <div className="w-16 flex flex-col items-center justify-center gap-4 text-white/20"><ArrowRight size={32} /><div className="w-0.5 h-20 bg-current rounded-full" /><ArrowLeft size={32} /></div>
           <div onDragOver={(e) => handleDragOver(e, 'RIGHT')} onDrop={(e) => handleDrop(e, 'RIGHT')} className={`flex-1 rounded-[2.5rem] p-6 flex flex-col transition-all duration-300 border-4 ${dragOverSide === 'RIGHT' ? 'bg-orange-600/20 border-orange-400 scale-[1.02] shadow-[0_0_50px_rgba(249,115,22,0.3)]' : 'bg-white border-white/10 shadow-2xl'}`}>
              <div className="flex justify-between items-end mb-6 pb-4 border-b border-gray-100"><div><span className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Destino</span><h2 className="text-xl font-bold text-gray-800">Nueva Cuenta</h2></div><div className="text-3xl font-black text-orange-600"><NumberTicker value={rightTotal} currency={currencySymbol} /></div></div>
              <div className="flex-1 overflow-y-auto space-y-3 pr-2">{rightItems.length === 0 ? (<div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-3xl m-4 text-gray-400"><MoveRight size={48} className="mb-4 animate-pulse" /><p className="font-bold">Arrastra items aquí</p></div>) : (rightItems.map(item => (<DraggableCard key={item.cartId} item={item} side="RIGHT" currencySymbol={currencySymbol} onDragStart={handleDragStart} onClick={handleItemClick} />)))}</div>
           </div>
        </div>
        <div className="mt-8 flex justify-end gap-4"><button onClick={onClose} className="px-8 py-4 rounded-2xl font-bold text-white/70 hover:bg-white/10 transition-colors">Cancelar</button><button onClick={() => onConfirm(leftItems, rightItems)} disabled={rightItems.length === 0} className={`px-10 py-4 rounded-2xl font-bold text-xl shadow-xl flex items-center gap-3 transition-all ${rightItems.length === 0 ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-orange-500 hover:bg-orange-400 text-white hover:scale-105 active:scale-95'}`}><Check size={24} strokeWidth={3} />Confirmar</button></div>
        {qtyModal.isOpen && qtyModal.item && (
           <div className="absolute inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"><div className="bg-white rounded-[2rem] p-8 w-full max-w-sm shadow-2xl animate-in zoom-in-95"><div className="text-center mb-8"><h3 className="text-lg font-bold text-gray-500 uppercase tracking-wide mb-2">¿Cuántos mover?</h3><div className="text-2xl font-black text-gray-800 leading-tight mb-1">{qtyModal.item.name}</div><div className="text-sm text-gray-400">Total disponible: {qtyModal.item.quantity}</div></div><div className="flex items-center justify-center gap-6 mb-8"><button onClick={() => setSliderValue(Math.max(1, sliderValue - 1))} className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-600">-</button><div className="w-24 h-24 bg-blue-50 rounded-3xl flex items-center justify-center border-4 border-blue-100 shadow-inner"><span className="text-5xl font-black text-blue-600">{sliderValue}</span></div><button onClick={() => setSliderValue(Math.min(qtyModal.item!.quantity, sliderValue + 1))} className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-600">+</button></div><div className="mb-8 px-4"><input type="range" min="1" max={qtyModal.item.quantity} value={sliderValue} onChange={(e) => setSliderValue(parseInt(e.target.value))} className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" /><div className="flex justify-between mt-2 text-xs font-bold text-gray-400"><span>1</span><span>{qtyModal.item.quantity}</span></div></div><div className="grid grid-cols-2 gap-3"><button onClick={() => setQtyModal({ ...qtyModal, isOpen: false })} className="py-4 rounded-xl font-bold text-gray-500 hover:bg-gray-100">Cancelar</button><button onClick={confirmQtyMove} className="py-4 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/30">Mover</button></div></div></div>
        )}
      </div>
    </div>
  );
};
const DraggableCard: React.FC<{ item: CartItem; side: 'LEFT' | 'RIGHT'; currencySymbol: string; onDragStart: (e: React.DragEvent, item: CartItem, side: 'LEFT' | 'RIGHT') => void; onClick: (item: CartItem, side: 'LEFT' | 'RIGHT') => void; }> = ({ item, side, currencySymbol, onDragStart, onClick }) => {
  return (
    <div draggable onDragStart={(e) => onDragStart(e, item, side)} onClick={() => onClick(item, side)} className="group bg-white p-4 rounded-2xl shadow-sm border border-gray-200 cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-md transition-all relative overflow-hidden select-none">
      <div className="flex items-center gap-4"><div className="text-gray-300 group-hover:text-blue-400"><GripVertical size={20} /></div><div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg shadow-sm ${side === 'LEFT' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{item.quantity}</div><div className="flex-1"><h4 className="font-bold text-gray-800 leading-tight">{item.name}</h4><p className="text-xs text-gray-400 mt-1 font-medium">{currencySymbol}{item.price.toFixed(2)} / un</p></div><div className="text-right font-bold text-gray-900 text-lg">{currencySymbol}{(item.price * item.quantity).toFixed(2)}</div></div>
    </div>
  );
};
export default SplitTicketModal;