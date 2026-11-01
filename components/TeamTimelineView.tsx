import React, { useState, useEffect, useMemo, useRef } from 'react';
import { format, startOfDay, addHours, eachHourOfInterval, isSameDay, isWithinInterval, addMinutes, roundToNearestMinutes } from 'date-fns';
import { es } from 'date-fns/locale';
import { motion, useDragControls } from 'framer-motion';
import { Activity, User, AttendanceLog, ServiceType } from '../types';
import { Clock, User as UserIcon, Users, Briefcase, Filter, ChevronLeft, ChevronRight, MoreHorizontal, CheckCircle2, AlertCircle } from 'lucide-react';

interface TeamTimelineViewProps {
    activities: Activity[];
    users: User[];
    attendanceLogs: AttendanceLog[];
    serviceTypes: ServiceType[];
    onActivityClick: (activity: Activity) => void;
    onAddActivity: (date: Date, userId: string) => void;
    onUpdateActivity: (activityId: string, newUserId: string, newStartDate: Date) => Promise<void>;
}

const TeamTimelineView: React.FC<TeamTimelineViewProps> = ({
    activities,
    users,
    attendanceLogs,
    serviceTypes,
    onActivityClick,
    onAddActivity,
    onUpdateActivity
}) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [filter, setFilter] = useState<'ALL' | 'SALES' | 'OPERATIONS' | 'PRESENT'>('ALL');
    const timelineRef = useRef<HTMLDivElement>(null);

    const dayStart = startOfDay(currentDate);
    const startHour = 8;
    const endHour = 20;
    const hours = eachHourOfInterval({
        start: addHours(dayStart, startHour),
        end: addHours(dayStart, endHour)
    });

    // Helper to get user status
    const getUserStatus = (userId: string) => {
        const userLogs = attendanceLogs.filter(l => l.userId === userId && isSameDay(new Date(l.timestamp), currentDate));
        if (userLogs.length === 0) return 'OFFLINE';

        const lastLog = [...userLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

        if (lastLog.type === 'CLOCK_OUT') return 'OFFLINE';

        // Check for BREAK if it existed in logs (but type is only CLOCK_IN / CLOCK_OUT in types.ts)
        // For now, if last is CLOCK_IN, they are ONLINE.
        return 'ONLINE';
    };

    const getActivityVisuals = (activity: Activity) => {
        switch (activity.status) {
            case 'CONFIRMED': return { className: 'bg-emerald-500 text-white', style: {} };
            case 'COMPLETED': return { className: 'bg-blue-500 text-white', style: {} };
            case 'CANCELLED': return { className: 'bg-red-100 text-red-500', style: {} };
            case 'PLANNED':
            default: {
                const typeDef = serviceTypes.find(t => t.name === activity.type && t.nature === activity.nature);
                const color = typeDef?.color || (activity.nature === 'BOOKING' ? '#9333ea' : '#4f46e5');
                return { className: 'text-white', style: { backgroundColor: color } };
            }
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'ONLINE': return 'bg-emerald-500';
            case 'BREAK': return 'bg-amber-500';
            case 'OFFLINE': return 'bg-gray-300';
            default: return 'bg-gray-300';
        }
    };

    const filteredUsers = useMemo(() => {
        return users.filter(u => {
            if (filter === 'ALL') return true;
            if (filter === 'SALES') return u.role?.toLowerCase().includes('ventas') || u.role?.toLowerCase().includes('sales');
            if (filter === 'OPERATIONS') return u.role?.toLowerCase().includes('opera') || u.role?.toLowerCase().includes('admin');
            if (filter === 'PRESENT') return getUserStatus(u.id) === 'ONLINE';
            return true;
        });
    }, [users, filter, attendanceLogs, currentDate]);

    const [ghostState, setGhostState] = useState<{ userId: string | null, startDate: Date | null, activity: Activity | null }>({
        userId: null,
        startDate: null,
        activity: null
    });

    // Helper to calculate time/user from drag info
    const calculateDropTarget = (point: { x: number, y: number }) => {
        if (!timelineRef.current) return null;

        // 1. Calculate Time (X)
        const gridContainer = document.getElementById('timeline-grid-area');
        if (!gridContainer) return null;

        const gridRect = gridContainer.getBoundingClientRect();
        const relativeX = point.x - gridRect.left;
        const widthPercent = Math.max(0, Math.min(1, relativeX / gridRect.width));

        const totalHours = endHour - startHour;
        const totalMinutes = totalHours * 60;
        const minutesOffset = totalMinutes * widthPercent;

        let newStartDate = addMinutes(addHours(dayStart, startHour), minutesOffset);
        newStartDate = roundToNearestMinutes(newStartDate, { nearestTo: 15 });

        // 2. Calculate User (Y)
        const elements = document.elementsFromPoint(point.x, point.y);
        const userRow = elements.find(el => el.getAttribute('data-user-id'));
        const newUserId = userRow ? userRow.getAttribute('data-user-id') : null;

        return { newStartDate, newUserId };
    };

    const handleDrag = (event: any, info: any, activity: Activity) => {
        const target = calculateDropTarget(info.point);
        if (target && target.newUserId) {
            setGhostState({
                userId: target.newUserId,
                startDate: target.newStartDate,
                activity: activity
            });
        }
    };

    const handleDragEnd = async (event: any, info: any, activity: Activity) => {
        setGhostState({ userId: null, startDate: null, activity: null }); // Clear ghost

        const target = calculateDropTarget(info.point);

        if (target && target.newUserId) {
            const { newUserId, newStartDate } = target;

            if (newUserId !== activity.assignedToId || !isSameDay(new Date(activity.startDate), newStartDate) || Math.abs(newStartDate.getTime() - new Date(activity.startDate).getTime()) > 60000) {
                try {
                    await onUpdateActivity(activity.id, newUserId, newStartDate);
                    console.log('Activity updated:', { newUserId, newStartDate });
                } catch (error) {
                    console.error('Failed to update activity', error);
                }
            }
        }
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100 font-sans">
            {/* Toolbar */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                <div className="flex items-center gap-6">
                    <h2 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                        <Users className="text-indigo-600" size={24} />
                        Vista de Equipo
                    </h2>

                    {/* Filter Chips */}
                    <div className="flex bg-gray-50 p-1 rounded-2xl border border-gray-100 gap-1">
                        {[
                            { id: 'ALL', label: 'Todos' },
                            { id: 'SALES', label: 'Ventas' },
                            { id: 'OPERATIONS', label: 'Operativos' },
                            { id: 'PRESENT', label: 'Presentes' }
                        ].map(c => (
                            <button
                                key={c.id}
                                onClick={() => setFilter(c.id as any)}
                                className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filter === c.id ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-100' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setCurrentDate(addHours(currentDate, -24))}
                        className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-colors"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <div className="px-4 py-2 bg-gray-50 rounded-xl">
                        <span className="text-sm font-black text-gray-700 uppercase tracking-tighter">
                            {format(currentDate, "EEEE, d 'de' MMMM", { locale: es })}
                        </span>
                    </div>
                    <button
                        onClick={() => setCurrentDate(addHours(currentDate, 24))}
                        className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-colors"
                    >
                        <ChevronRight size={20} />
                    </button>
                </div>
            </div>

            {/* Timeline Grid */}
            <div ref={timelineRef} className="flex-1 overflow-auto custom-scrollbar relative">
                <div className="min-w-max">
                    {/* Header: Hours (8:00 - 20:00) */}
                    <div className="flex border-b border-gray-100 sticky top-0 z-20 bg-white/80 backdrop-blur-md">
                        <div className="w-56 shrink-0 border-r border-gray-100 p-4 bg-gray-50/50">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Colaborador</span>
                        </div>
                        {hours.map(h => (
                            <div key={h.toISOString()} className="flex-1 min-w-[120px] p-4 text-center border-r border-gray-100 last:border-0 relative">
                                <span className="text-[10px] font-black text-gray-900">{format(h, 'HH:mm')}</span>
                            </div>
                        ))}
                    </div>

                    {/* Body: Team Members */}
                    <div id="timeline-grid-area" className="relative">
                        {filteredUsers.map(user => (
                            <div
                                key={user.id}
                                data-user-id={user.id}
                                className="flex border-b border-gray-100 min-h-[80px] group/row relative z-0"
                            >
                                {/* User Info Column */}
                                <div className="w-56 shrink-0 border-r border-gray-100 p-4 bg-white flex items-center gap-3 sticky left-0 z-20">
                                    <div className="relative">
                                        {user.photo ? (
                                            <img src={user.photo} alt={user.name} className="w-10 h-10 rounded-2xl object-cover ring-2 ring-gray-100 shadow-sm" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 ring-2 ring-gray-100 shadow-sm">
                                                <UserIcon size={20} />
                                            </div>
                                        )}
                                        <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white ${getStatusColor(getUserStatus(user.id))}`} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-black text-gray-900 truncate">{user.name}</p>
                                        <p className="text-[9px] font-bold text-gray-400 uppercase truncate leading-none mt-0.5">{user.role}</p>
                                    </div>
                                </div>

                                {/* Schedule Area */}
                                <div className="flex-1 relative flex z-0 overflow-visible">
                                    {/* Grid Background */}
                                    {hours.map(h => (
                                        <div
                                            key={h.toISOString()}
                                            className="flex-1 min-w-[120px] border-r border-gray-100/50 last:border-0 cursor-pointer hover:bg-indigo-50/20 transition-colors"
                                            onClick={() => onAddActivity(h, user.id)}
                                        />
                                    ))}

                                    {/* Ghost Element */}
                                    {ghostState.userId === user.id && ghostState.startDate && ghostState.activity && (
                                        (() => {
                                            const start = ghostState.startDate;
                                            const originalStart = new Date(ghostState.activity.startDate);
                                            const originalEnd = new Date(ghostState.activity.endDate);
                                            const duration = originalEnd.getTime() - originalStart.getTime();
                                            const end = new Date(start.getTime() + duration);

                                            const dayTimelineStart = addHours(dayStart, startHour).getTime();
                                            const totalDuration = (endHour - startHour) * 3600 * 1000;
                                            const left = ((start.getTime() - dayTimelineStart) / totalDuration) * 100;
                                            const width = (duration / totalDuration) * 100;

                                            return (
                                                <div
                                                    className="absolute top-[10%] bottom-[10%] border-2 border-dashed border-indigo-400 bg-indigo-50/40 rounded-2xl z-0 pointer-events-none transition-all duration-75"
                                                    style={{ left: `${left}%`, width: `${width}%` }}
                                                >
                                                    <div className="px-3 py-1 opacity-50">
                                                        <p className="text-[9px] font-bold text-indigo-800">
                                                            {format(start, 'HH:mm')}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })()
                                    )}

                                    {/* Activities Layer */}
                                    {activities
                                        .filter(a => a.assignedToId === user.id && isSameDay(new Date(a.startDate), currentDate))
                                        .map(activity => {
                                            const start = new Date(activity.startDate);
                                            const end = new Date(activity.endDate);
                                            const dayTimelineStart = addHours(dayStart, startHour).getTime();
                                            const dayTimelineEnd = addHours(dayStart, endHour).getTime();

                                            // Visibility check
                                            if (start.getTime() > dayTimelineEnd || end.getTime() < dayTimelineStart) return null;

                                            const effectiveStart = Math.max(start.getTime(), dayTimelineStart);
                                            const effectiveEnd = Math.min(end.getTime(), dayTimelineEnd);

                                            const totalDuration = (endHour - startHour) * 3600 * 1000;
                                            const left = ((effectiveStart - dayTimelineStart) / totalDuration) * 100;
                                            // duration in ms / total duration in ms * 100
                                            const width = ((effectiveEnd - effectiveStart) / totalDuration) * 100;

                                            const isDragging = ghostState.activity?.id === activity.id;
                                            const visuals = getActivityVisuals(activity);

                                            return (
                                                <motion.div
                                                    key={activity.id}
                                                    drag
                                                    dragConstraints={timelineRef}
                                                    dragElastic={0.1}
                                                    dragMomentum={false}
                                                    onDrag={(e, info) => handleDrag(e, info, activity)}
                                                    onDragEnd={(e, info) => handleDragEnd(e, info, activity)}
                                                    whileDrag={{
                                                        scale: 1.05,
                                                        zIndex: 100,
                                                        boxShadow: "0px 20px 40px rgba(0,0,0,0.2)",
                                                        cursor: "grabbing",
                                                        opacity: 0.6 // Make transparent to see ghost
                                                    }}
                                                    onClick={(e) => {
                                                        e.stopPropagation(); // Prevent grid click
                                                        onActivityClick(activity);
                                                    }}
                                                    style={{
                                                        left: `${left}%`,
                                                        width: `${width}%`,
                                                        top: '10%',
                                                        bottom: '10%',
                                                        position: 'absolute',
                                                        ...visuals.style
                                                    }}
                                                    className={`rounded-2xl shadow-sm cursor-grab border-l-4 border-black/10 flex flex-col justify-center overflow-hidden z-10 ${isDragging ? 'pointer-events-none' : ''} ${visuals.className}`}
                                                >
                                                    <div className="px-3 py-1 pointer-events-none">
                                                        <div className="flex items-center justify-between gap-1">
                                                            <p className="text-[10px] font-black truncate leading-none">{activity.title}</p>
                                                            {activity.status === 'COMPLETED' ? <CheckCircle2 size={10} className="opacity-80" /> : null}
                                                        </div>
                                                        <p className="text-[9px] font-bold opacity-80 truncate mt-0.5">
                                                            {format(start, 'HH:mm')} - {format(end, 'HH:mm')}
                                                        </p>
                                                    </div>

                                                    {/* Hover Tooltip */}
                                                    <div className="absolute inset-0 bg-black/80 opacity-0 hover:opacity-100 transition-opacity p-2 flex flex-col justify-center gap-0.5 pointer-events-none text-white">
                                                        <p className="text-[8px] font-black text-indigo-300 uppercase leading-none">Cliente</p>
                                                        <p className="text-[10px] font-bold truncate">{activity.customerName || 'N/A'}</p>
                                                        <p className="text-[8px] font-black text-indigo-300 uppercase leading-none mt-1">Estado</p>
                                                        <p className="text-[10px] font-bold uppercase">{activity.status}</p>
                                                    </div>
                                                </motion.div>
                                            );
                                        })
                                    }
                                </div>
                            </div>
                        ))}

                        {filteredUsers.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                                <AlertCircle size={48} className="mb-4 opacity-20" />
                                <p className="text-sm font-black uppercase tracking-widest">No hay miembros para mostrar</p>
                                <p className="text-[10px] font-bold">Ajusta los filtros o verifica los roles</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500" />
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Online</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-amber-500" />
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Break</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-gray-300" />
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Offline</span>
                    </div>
                </div>

                <p className="text-[10px] font-bold text-gray-400 uppercase italic">
                    * Arrastra eventos en cualquier dirección para re-programar.
                </p>
            </div>
        </div>
    );
};

export default TeamTimelineView;
