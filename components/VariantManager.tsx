
import React, { useState } from 'react';
import { 
  Palette, Type, Image as ImageIcon, Plus, Trash2, Edit2, 
  X, LayoutGrid, CheckSquare, Layers, FolderInput
} from 'lucide-react';
import { AttributeDefinition, AttributeValue, VariantTemplate, AttributeType } from '../types';

interface VariantManagerProps {
  onClose: () => void;
}

// MOCK DATA (Simulating Database)
const MOCK_ATTRIBUTES: AttributeDefinition[] = [
  {
    id: 'attr_size',
    name: 'Talla Ropa',
    type: 'TEXT',
    values: [
      { id: 'v1', name: 'Pequeño', shortCode: 'S', value: 'S' },
      { id: 'v2', name: 'Mediano', shortCode: 'M', value: 'M' },
      { id: 'v3', name: 'Grande', shortCode: 'L', value: 'L' },
      { id: 'v4', name: 'Extra Grande', shortCode: 'XL', value: 'XL' },
    ]
  },
  {
    id: 'attr_color',
    name: 'Color Base',
    type: 'COLOR',
    values: [
      { id: 'c1', name: 'Rojo Pasión', shortCode: 'RJ', value: '#EF4444' },
      { id: 'c2', name: 'Azul Marino', shortCode: 'AZ', value: '#1E3A8A' },
      { id: 'c3', name: 'Negro', shortCode: 'NG', value: '#000000' },
      { id: 'c4', name: 'Blanco', shortCode: 'BL', value: '#FFFFFF' },
      { id: 'c5', name: 'Verde Bosque', shortCode: 'VD', value: '#064E3B' },
    ]
  }
];

const MOCK_TEMPLATES: VariantTemplate[] = [
  { id: 't1', name: 'Tallas Estándar (Adulto)', attributeId: 'attr_size', valueIds: ['v1', 'v2', 'v3', 'v4'] },
  { id: 't2', name: 'Colores Corporativos', attributeId: 'attr_color', valueIds: ['c2', 'c3', 'c4'] }
];

const VariantManager: React.FC<VariantManagerProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'ATTRIBUTES' | 'TEMPLATES'>('ATTRIBUTES');
  
  // Data State
  const [attributes, setAttributes] = useState<AttributeDefinition[]>(MOCK_ATTRIBUTES);
  const [templates, setTemplates] = useState<VariantTemplate[]>(MOCK_TEMPLATES);

  // Selection State
  const [selectedAttributeId, setSelectedAttributeId] = useState<string | null>(attributes[0]?.id || null);
  const [editingValue, setEditingValue] = useState<Partial<AttributeValue> | null>(null);
  
  // Template Editing
  const [editingTemplate, setEditingTemplate] = useState<Partial<VariantTemplate> | null>(null);

  const selectedAttribute = attributes.find(a => a.id === selectedAttributeId);

  // --- HANDLERS: ATTRIBUTES ---
  const handleAddAttribute = () => {
    const newAttr: AttributeDefinition = {
      id: `attr_${Date.now()}`,
      name: 'Nuevo Atributo',
      type: 'TEXT',
      values: []
    };
    setAttributes([...attributes, newAttr]);
    setSelectedAttributeId(newAttr.id);
  };

  const handleUpdateAttribute = (id: string, updates: Partial<AttributeDefinition>) => {
    setAttributes(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  };

  const handleDeleteAttribute = (id: string) => {
    if (confirm("¿Eliminar este atributo y todos sus valores?")) {
      setAttributes(prev => prev.filter(a => a.id !== id));
      if (selectedAttributeId === id) setSelectedAttributeId(null);
    }
  };

  // --- HANDLERS: VALUES ---
  const handleAddValue = () => {
    if (!selectedAttribute) return;
    setEditingValue({
      id: `val_${Date.now()}`,
      name: '',
      shortCode: '',
      value: selectedAttribute.type === 'COLOR' ? '#000000' : ''
    });
  };

  const handleSaveValue = () => {
    if (!selectedAttribute || !editingValue?.name) return;
    
    // Auto-generate ShortCode if empty
    const finalShortCode = editingValue.shortCode || editingValue.name?.substring(0, 3).toUpperCase();
    const finalValue = editingValue.value || editingValue.name;

    const newValue: AttributeValue = {
      id: editingValue.id || `v_${Date.now()}`,
      name: editingValue.name!,
      shortCode: finalShortCode,
      value: finalValue!
    };

    const existingIndex = selectedAttribute.values.findIndex(v => v.id === newValue.id);
    const newValues = [...selectedAttribute.values];
    
    if (existingIndex >= 0) {
      newValues[existingIndex] = newValue;
    } else {
      newValues.push(newValue);
    }

    handleUpdateAttribute(selectedAttribute.id, { values: newValues });
    setEditingValue(null);
  };

  const handleDeleteValue = (valId: string) => {
    if (!selectedAttribute) return;
    const newValues = selectedAttribute.values.filter(v => v.id !== valId);
    handleUpdateAttribute(selectedAttribute.id, { values: newValues });
  };

  // --- HANDLERS: TEMPLATES ---
  const handleSaveTemplate = () => {
    if (!editingTemplate?.name || !editingTemplate.attributeId) return;
    
    const newTemplate: VariantTemplate = {
      id: editingTemplate.id || `tpl_${Date.now()}`,
      name: editingTemplate.name,
      attributeId: editingTemplate.attributeId,
      valueIds: editingTemplate.valueIds || []
    };

    setTemplates(prev => {
      const exists = prev.findIndex(t => t.id === newTemplate.id);
      if (exists >= 0) {
        const copy = [...prev];
        copy[exists] = newTemplate;
        return copy;
      }
      return [...prev, newTemplate];
    });
    setEditingTemplate(null);
  };

  return (
    <div className="responsive-shell flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
      
      {/* Header */}
      <div className="bg-white px-4 md:px-8 py-4 md:py-6 border-b border-gray-200 flex flex-col gap-4 md:flex-row md:justify-between md:items-center shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-2">
             <Layers className="text-pink-600" /> Configuración de Variantes
          </h1>
          <p className="text-sm text-gray-500">Define atributos maestros (Talla, Color) y crea grupos de uso rápido.</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors self-end md:self-auto">
           <X size={24} />
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white shrink-0 px-4 md:px-8 overflow-hidden">
         <div className="mobile-tab-scroller no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
               <button 
                  onClick={() => setActiveTab('ATTRIBUTES')}
                  className={`mobile-tab-item pb-4 pt-4 text-[11px] md:text-sm font-bold border-b-4 transition-all ${activeTab === 'ATTRIBUTES' ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-400'}`}
               >
                  Maestro de Atributos
               </button>
               <button 
                  onClick={() => setActiveTab('TEMPLATES')}
                  className={`mobile-tab-item pb-4 pt-4 text-[11px] md:text-sm font-bold border-b-4 transition-all ${activeTab === 'TEMPLATES' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-400'}`}
               >
                  Grupos Predefinidos (Templates)
               </button>
         </div>
      </div>

      <div className="responsive-content flex-1 overflow-hidden p-4 md:p-8">
         
         {/* === ATTRIBUTES VIEW === */}
         {activeTab === 'ATTRIBUTES' && (
            <div className="flex flex-col md:flex-row h-full gap-8">
               
               {/* Sidebar List */}
               <div className="w-full md:w-1/3 flex flex-col gap-4">
                  <button 
                     onClick={handleAddAttribute}
                     className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 font-bold hover:border-pink-400 hover:text-pink-600 transition-colors flex items-center justify-center gap-2"
                  >
                     <Plus size={18} /> Crear Atributo
                  </button>
                  
                  <div className="flex-1 overflow-y-auto space-y-3">
                     {attributes.map(attr => (
                        <div 
                           key={attr.id}
                           onClick={() => setSelectedAttributeId(attr.id)}
                           className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-between ${
                              selectedAttributeId === attr.id 
                                 ? 'bg-white border-pink-500 shadow-md ring-2 ring-pink-50' 
                                 : 'bg-white border-gray-100 hover:border-gray-200'
                           }`}
                        >
                           <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg ${selectedAttributeId === attr.id ? 'bg-pink-100 text-pink-600' : 'bg-gray-100 text-gray-500'}`}>
                                 {attr.type === 'COLOR' ? <Palette size={18} /> : attr.type === 'IMAGE' ? <ImageIcon size={18} /> : <Type size={18} />}
                              </div>
                              <div>
                                 <h4 className="font-bold text-gray-800">{attr.name}</h4>
                                 <p className="text-xs text-gray-400">{attr.values.length} valores definidos</p>
                              </div>
                           </div>
                           <button onClick={(e) => { e.stopPropagation(); handleDeleteAttribute(attr.id); }} className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
                        </div>
                     ))}
                  </div>
               </div>

               {/* Detail View */}
               <div className="flex-1 bg-white rounded-3xl shadow-lg border border-gray-200 p-8 flex flex-col relative overflow-hidden">
                  {selectedAttribute ? (
                     <>
                        {/* Attribute Settings */}
                        <div className="flex gap-4 mb-8 border-b border-gray-100 pb-6">
                           <div className="flex-1">
                              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre Atributo</label>
                              <input 
                                 type="text" 
                                 value={selectedAttribute.name}
                                 onChange={(e) => handleUpdateAttribute(selectedAttribute.id, { name: e.target.value })}
                                 className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-pink-500"
                              />
                           </div>
                           <div className="w-48">
                              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tipo Visual</label>
                              <select 
                                 value={selectedAttribute.type}
                                 onChange={(e) => handleUpdateAttribute(selectedAttribute.id, { type: e.target.value as AttributeType })}
                                 className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none"
                              >
                                 <option value="TEXT">Texto / Botón</option>
                                 <option value="COLOR">Color / Patrón</option>
                                 <option value="IMAGE">Imagen Miniatura</option>
                              </select>
                           </div>
                        </div>

                        {/* Values List */}
                        <div className="flex justify-between items-center mb-4">
                           <h3 className="font-bold text-gray-700">Valores Disponibles</h3>
                           <button onClick={handleAddValue} className="px-3 py-1.5 bg-pink-50 text-pink-600 rounded-lg text-xs font-bold hover:bg-pink-100 transition-colors flex items-center gap-1">
                              <Plus size={14} /> Agregar Valor
                           </button>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                           {selectedAttribute.values.map(val => (
                              <div key={val.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 hover:bg-white hover:shadow-sm transition-all group">
                                 <div className="flex items-center gap-4">
                                    {/* Visual Preview */}
                                    <div className="w-10 h-10 rounded-full border border-gray-200 shadow-inner flex items-center justify-center overflow-hidden bg-white">
                                       {selectedAttribute.type === 'COLOR' ? (
                                          <div className="w-full h-full" style={{ backgroundColor: val.value }}></div>
                                       ) : selectedAttribute.type === 'IMAGE' ? (
                                          <img src={val.value} className="w-full h-full object-cover" />
                                       ) : (
                                          <span className="text-xs font-bold text-gray-600">{val.shortCode}</span>
                                       )}
                                    </div>
                                    <div>
                                       <p className="font-bold text-gray-800 text-sm">{val.name}</p>
                                       <p className="text-xs text-gray-400 font-mono bg-gray-200 px-1.5 rounded inline-block mt-0.5">SKU: {val.shortCode}</p>
                                    </div>
                                 </div>
                                 <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => setEditingValue(val)} className="p-2 text-gray-400 hover:text-blue-500 bg-white border border-gray-100 rounded-lg shadow-sm"><Edit2 size={16} /></button>
                                    <button onClick={() => handleDeleteValue(val.id)} className="p-2 text-gray-400 hover:text-red-500 bg-white border border-gray-100 rounded-lg shadow-sm"><Trash2 size={16} /></button>
                                 </div>
                              </div>
                           ))}
                           {selectedAttribute.values.length === 0 && (
                              <div className="text-center py-10 text-gray-400 text-sm italic">No hay valores configurados.</div>
                           )}
                        </div>

                     </>
                  ) : (
                     <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                        <LayoutGrid size={48} className="mb-4 opacity-50" />
                        <p>Selecciona un atributo para editar</p>
                     </div>
                  )}

                  {/* Value Editor Modal Overlay */}
                  {editingValue && (
                     <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center p-8 z-10 animate-in fade-in">
                        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm p-6">
                           <h3 className="font-bold text-lg text-gray-800 mb-4">{editingValue.id ? 'Editar Valor' : 'Nuevo Valor'}</h3>
                           
                           <div className="space-y-4">
                              <div>
                                 <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre (Etiqueta)</label>
                                 <input 
                                    type="text" 
                                    value={editingValue.name} 
                                    onChange={(e) => setEditingValue({...editingValue, name: e.target.value})} 
                                    className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-pink-500"
                                    placeholder="Ej. Azul Marino"
                                    autoFocus
                                 />
                              </div>
                              
                              <div>
                                 <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Código Corto (Para SKU)</label>
                                 <input 
                                    type="text" 
                                    value={editingValue.shortCode} 
                                    onChange={(e) => setEditingValue({...editingValue, shortCode: e.target.value.toUpperCase()})} 
                                    className="w-full p-3 border border-gray-200 rounded-xl font-mono uppercase"
                                    placeholder="Ej. AZ"
                                    maxLength={4}
                                 />
                              </div>

                              {selectedAttribute?.type === 'COLOR' && (
                                 <div>
                                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Selector de Color</label>
                                    <div className="flex items-center gap-2">
                                       <input 
                                          type="color" 
                                          value={editingValue.value} 
                                          onChange={(e) => setEditingValue({...editingValue, value: e.target.value})} 
                                          className="h-12 w-12 border-none cursor-pointer bg-transparent"
                                       />
                                       <input 
                                          type="text" 
                                          value={editingValue.value} 
                                          onChange={(e) => setEditingValue({...editingValue, value: e.target.value})} 
                                          className="flex-1 p-3 border border-gray-200 rounded-xl font-mono text-sm uppercase"
                                       />
                                    </div>
                                 </div>
                              )}
                           </div>

                           <div className="flex gap-2 mt-6">
                              <button onClick={() => setEditingValue(null)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl">Cancelar</button>
                              <button onClick={handleSaveValue} className="flex-1 py-3 bg-pink-600 text-white font-bold rounded-xl hover:bg-pink-700 shadow-md">Guardar</button>
                           </div>
                        </div>
                     </div>
                  )}
               </div>
            </div>
         )}

         {/* === TEMPLATES VIEW === */}
         {activeTab === 'TEMPLATES' && (
            <div className="flex flex-col md:flex-row h-full gap-8">
               
               {/* Templates List */}
               <div className="w-full md:w-1/3 flex flex-col gap-4">
                  <button 
                     onClick={() => setEditingTemplate({ name: '', attributeId: attributes[0]?.id || '', valueIds: [] })}
                     className="w-full py-3 bg-purple-50 text-purple-700 border border-purple-200 rounded-xl font-bold hover:bg-purple-100 transition-colors flex items-center justify-center gap-2"
                  >
                     <Plus size={18} /> Crear Nuevo Grupo
                  </button>
                  
                  <div className="flex-1 overflow-y-auto space-y-3">
                     {templates.map(tpl => {
                        const attr = attributes.find(a => a.id === tpl.attributeId);
                        return (
                           <div key={tpl.id} onClick={() => setEditingTemplate(tpl)} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm cursor-pointer hover:border-purple-300 hover:shadow-md transition-all">
                              <h4 className="font-bold text-gray-800">{tpl.name}</h4>
                              <div className="flex justify-between items-center mt-2">
                                 <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded flex items-center gap-1">
                                    <FolderInput size={12} /> {attr?.name || 'Desconocido'}
                                 </span>
                                 <span className="text-xs font-bold text-purple-600">{tpl.valueIds.length} opciones</span>
                              </div>
                           </div>
                        );
                     })}
                  </div>
               </div>

               {/* Template Editor */}
               <div className="flex-1 bg-white rounded-3xl shadow-lg border border-gray-200 p-8 flex flex-col">
                  {editingTemplate ? (
                     <>
                        <h3 className="font-black text-xl text-gray-800 mb-6">{editingTemplate.id ? 'Editar Grupo' : 'Nuevo Grupo'}</h3>
                        
                        <div className="grid grid-cols-2 gap-6 mb-6">
                           <div>
                              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre del Grupo</label>
                              <input 
                                 type="text" 
                                 value={editingTemplate.name}
                                 onChange={(e) => setEditingTemplate({...editingTemplate, name: e.target.value})}
                                 className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
                                 placeholder="Ej. Tallas Bebé"
                              />
                           </div>
                           <div>
                              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Atributo Base</label>
                              <select 
                                 value={editingTemplate.attributeId}
                                 onChange={(e) => setEditingTemplate({...editingTemplate, attributeId: e.target.value, valueIds: []})}
                                 className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none"
                              >
                                 {attributes.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                           </div>
                        </div>

                        <div className="flex-1 overflow-y-auto border-t border-gray-100 pt-4">
                           <p className="text-xs font-bold text-gray-400 uppercase mb-3">Selecciona los valores a incluir:</p>
                           <div className="grid grid-cols-2 gap-3">
                              {attributes.find(a => a.id === editingTemplate.attributeId)?.values.map(val => {
                                 const isChecked = editingTemplate.valueIds?.includes(val.id);
                                 return (
                                    <div 
                                       key={val.id} 
                                       onClick={() => {
                                          const newIds = isChecked 
                                             ? editingTemplate.valueIds?.filter(id => id !== val.id)
                                             : [...(editingTemplate.valueIds || []), val.id];
                                          setEditingTemplate({...editingTemplate, valueIds: newIds});
                                       }}
                                       className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                                          isChecked 
                                             ? 'bg-purple-50 border-purple-500 text-purple-800 shadow-sm' 
                                             : 'bg-white border-gray-200 hover:border-purple-200'
                                       }`}
                                    >
                                       <span className="font-bold text-sm">{val.name}</span>
                                       {isChecked && <CheckSquare size={18} className="text-purple-600" />}
                                    </div>
                                 );
                              })}
                           </div>
                        </div>

                        <div className="flex gap-3 mt-6 border-t border-gray-100 pt-6">
                           <button onClick={() => setEditingTemplate(null)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl">Cancelar</button>
                           <button onClick={handleSaveTemplate} className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 shadow-md">
                              Guardar Grupo
                           </button>
                        </div>
                     </>
                  ) : (
                     <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                        <Layers size={48} className="mb-4 opacity-50" />
                        <p>Selecciona un grupo para editar</p>
                     </div>
                  )}
               </div>
            </div>
         )}

      </div>
    </div>
  );
};

export default VariantManager;
