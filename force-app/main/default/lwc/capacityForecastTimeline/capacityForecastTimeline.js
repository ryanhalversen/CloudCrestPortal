import { LightningElement, wire } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import CHARTJS from '@salesforce/resourceUrl/chartjs';
import getCapacityData from '@salesforce/apex/TeamCapacityController.getCapacityData';

const FTE_CAPACITY = 105; // h/week — 3 FTEs × 35h each
const YEAR_START = new Date(2026, 0, 5);  // Jan 5, 2026 (first Monday of 2026)
const YEAR_END   = new Date(2026, 11, 28); // Dec 28, 2026 (last Monday in Dec)

export default class CapacityForecastTimeline extends LightningElement {
    _chart = null;
    _chartjsLoaded = false;
    _data = null;
    isLoading = true;
    error = null;

    // ── Wire ──────────────────────────────────────────────────────────────
    @wire(getCapacityData)
    wiredData({ data, error }) {
        this.isLoading = false;
        if (data) {
            this._data = data;
            this.error = null;
            this._tryRenderChart();
        } else if (error) {
            this.error = error?.body?.message || 'Failed to load capacity data.';
            this._data = null;
        }
    }

    connectedCallback() {
        loadScript(this, CHARTJS)
            .then(() => {
                this._chartjsLoaded = true;
                this._tryRenderChart();
            })
            .catch(err => {
                this.error = 'Failed to load chart library.';
                console.error('Chart.js load error:', err);
            });
    }

    disconnectedCallback() {
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }

    // ── Chart init ────────────────────────────────────────────────────────
    _tryRenderChart() {
        if (!this._chartjsLoaded || !this._data || this.isLoading) return;

        // Defer to ensure canvas is rendered in DOM
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => this._renderChart(), 0);
    }

    _renderChart() {
        const canvas = this.refs.canvas;
        if (!canvas) return;
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }

        const { labels, weeks, demandData, capacityData, projectsByWeek, projectEndpoints, todayIndex, totalCapacity } = this._buildForecast();

        // Over-capacity fill dataset: mirrors demand data but used for fill zone
        const overCapacityData = demandData.map(d => (d > totalCapacity ? d : totalCapacity));

        // Custom plugin: vertical "Today" line + project end markers
        const todayLinePlugin = {
            id: 'todayLine',
            afterDraw(chart) {
                const { ctx, scales: { x, y } } = chart;

                // Draw "Today" vertical line
                if (todayIndex >= 0) {
                    const xPos = x.getPixelForValue(todayIndex);
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(xPos, y.top);
                    ctx.lineTo(xPos, y.bottom);
                    ctx.strokeStyle = 'rgba(239,68,68,0.85)';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([4, 3]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillStyle = 'rgba(239,68,68,0.85)';
                    ctx.font = 'bold 11px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Today', xPos, y.top - 6);
                    ctx.restore();
                }

                // Draw project end markers on the demand line
                const endpointsByWeek = {};
                projectEndpoints.forEach(ep => {
                    if (!endpointsByWeek[ep.weekIndex]) endpointsByWeek[ep.weekIndex] = [];
                    endpointsByWeek[ep.weekIndex].push(ep.name);
                });

                Object.entries(endpointsByWeek).forEach(([weekIndexStr, names]) => {
                    const weekIndex = parseInt(weekIndexStr, 10);
                    const xPos = x.getPixelForValue(weekIndex);
                    const dotY = y.getPixelForValue(demandData[weekIndex]);

                    // Filled circle at the demand line point
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(xPos, dotY, 4, 0, Math.PI * 2);
                    ctx.fillStyle = '#f59e0b';
                    ctx.fill();
                    ctx.restore();

                    // Stem and label for each project ending this week
                    names.forEach((name, stackPos) => {
                        const stemTop = dotY - 18 - (stackPos * 14);
                        const truncatedName = name.length > 18 ? name.substring(0, 18) : name;

                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(xPos, dotY - 4);
                        ctx.lineTo(xPos, stemTop);
                        ctx.strokeStyle = '#f59e0b';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                        ctx.restore();

                        ctx.save();
                        ctx.font = '11px sans-serif';
                        ctx.fillStyle = '#374151';
                        ctx.textAlign = 'left';
                        ctx.translate(xPos + 3, stemTop);
                        ctx.rotate(-Math.PI / 4);
                        ctx.fillText(truncatedName, 0, 0);
                        ctx.restore();
                    });
                });
            }
        };

        /* global Chart */
        this._chart = new Chart(canvas, {
            plugins: [todayLinePlugin],
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        // Dataset 0 — Projected Demand
                        label: 'Projected Demand',
                        data: demandData,
                        borderColor: '#f59e0b',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#f59e0b',
                        fill: false,
                        order: 1
                    },
                    {
                        // Dataset 1 — Team Capacity
                        label: 'Team Capacity',
                        data: capacityData,
                        borderColor: '#0e7490',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [6, 4],
                        tension: 0,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        fill: false,
                        order: 2
                    },
                    {
                        // Dataset 2 — Over-capacity fill zone (hidden from legend)
                        label: '_overcapacity',
                        data: overCapacityData,
                        borderColor: 'transparent',
                        backgroundColor: 'rgba(239,68,68,0.12)',
                        borderWidth: 0,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        fill: {
                            target: 1, // fill relative to Team Capacity (dataset index 1)
                            above: 'rgba(239,68,68,0.12)',
                            below: 'transparent'
                        },
                        order: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { top: 20 }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: false // using custom HTML legend
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                return `Week of ${items[0].label}`;
                            },
                            beforeBody: (items) => {
                                const idx = items[0].dataIndex;
                                const demand = demandData[idx];
                                const delta = demand - totalCapacity;
                                const deltaStr = delta >= 0
                                    ? `+${Math.round(delta * 10) / 10}h over`
                                    : `${Math.round(Math.abs(delta) * 10) / 10}h under`;
                                return [
                                    `Demand:   ${Math.round(demand * 10) / 10}h`,
                                    `Capacity: ${totalCapacity}h`,
                                    `Delta:    ${deltaStr}`
                                ];
                            },
                            label: () => null, // suppress default labels (we use beforeBody)
                            afterBody: (items) => {
                                const idx = items[0].dataIndex;
                                const projects = projectsByWeek[idx];
                                if (!projects || projects.length === 0) return [];
                                const lines = ['', 'Projects:'];
                                projects.forEach(p => {
                                    lines.push(`  ${p.name}: ${Math.round(p.pace * 10) / 10}h/wk`);
                                });
                                return lines;
                            }
                        },
                        filter: (item) => item.dataset.label !== '_overcapacity'
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45,
                            font: { size: 11 },
                            callback: (value, index) => {
                                const week = weeks[index];
                                if (!week) return null;
                                // Show a label only when the 1st of a month falls within this week (Mon–Sun)
                                for (let d = 0; d < 7; d++) {
                                    const day = new Date(week);
                                    day.setDate(week.getDate() + d);
                                    if (day.getDate() === 1) {
                                        return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                    }
                                }
                                return null;
                            }
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.06)'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: Math.max(...demandData, totalCapacity) + 10,
                        title: {
                            display: true,
                            text: 'Hours / week',
                            font: { size: 12 }
                        },
                        ticks: {
                            font: { size: 11 }
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.06)'
                        }
                    }
                }
            }
        });
    }

    // ── Forecast computation ──────────────────────────────────────────────
    _buildForecast() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTime = today.getTime();

        // Generate all Monday week slots for the full calendar year
        const weeks = [];
        const cur = new Date(YEAR_START);
        while (cur <= YEAR_END) {
            weeks.push(new Date(cur));
            cur.setDate(cur.getDate() + 7);
        }

        // Find the index of the week containing today
        let todayIndex = -1;
        for (let i = 0; i < weeks.length; i++) {
            const weekEnd = new Date(weeks[i]);
            weekEnd.setDate(weekEnd.getDate() + 6);
            if (todayTime >= weeks[i].getTime() && todayTime <= weekEnd.getTime()) {
                todayIndex = i;
                break;
            }
        }

        const labels = weeks.map(w =>
            w.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        );

        const projects = this._data.projects || [];

        const demandData = [];
        const projectsByWeek = [];

        weeks.forEach(weekStart => {
            const weekTime = weekStart.getTime();
            let weekDemand = 0;
            const weekProjects = [];

            projects.forEach(p => {
                const pace = p.onTimeWeeklyPace || 0;
                if (pace <= 0) return;

                if (!p.endDate) {
                    console.warn(`[capacityForecastTimeline] Project "${p.name}" has no end date — excluded from forecast.`);
                    return;
                }

                const projectEndTime = new Date(p.endDate + 'T00:00:00').getTime();
                const isOverdue = projectEndTime < todayTime;

                if (isOverdue) {
                    // Overdue but still In Progress → contributes to all forecast weeks
                    weekDemand += pace;
                    weekProjects.push({ name: p.name, pace });
                } else if (weekTime <= projectEndTime) {
                    // Active project — contributes while this week is before end date
                    weekDemand += pace;
                    weekProjects.push({ name: p.name, pace });
                }
            });

            demandData.push(Math.round(weekDemand * 10) / 10);
            projectsByWeek.push(weekProjects);
        });

        const contractorCapacity = (this._data.contractors || [])
            .reduce((s, c) => s + (c.weeklyHours || 0), 0);
        const totalCapacity = FTE_CAPACITY + contractorCapacity;

        const capacityData = weeks.map(() => totalCapacity);

        // Build end-date markers for non-overdue projects
        const projectEndpoints = [];
        projects.forEach(p => {
            if (!p.endDate) return;
            const projectEndTime = new Date(p.endDate + 'T00:00:00').getTime();
            if (projectEndTime < todayTime) return; // skip overdue
            for (let i = 0; i < weeks.length; i++) {
                const weekEnd = new Date(weeks[i]);
                weekEnd.setDate(weekEnd.getDate() + 6);
                if (projectEndTime >= weeks[i].getTime() && projectEndTime <= weekEnd.getTime()) {
                    projectEndpoints.push({ weekIndex: i, name: p.name });
                    break;
                }
            }
        });

        return { labels, weeks, demandData, capacityData, projectsByWeek, projectEndpoints, todayIndex, totalCapacity };
    }
}
