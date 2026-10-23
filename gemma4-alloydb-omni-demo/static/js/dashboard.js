let telemetryChart = null;
const maxDataPoints = 60;
let selectedEventId = null;
let currentEventData = null;
let lastKnownEventId = null;

function initChart() {
    const canvas = document.getElementById('telemetryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    telemetryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({ length: maxDataPoints }, () => ''),
            datasets: [
                {
                    label: 'Pressure (bar)',
                    data: Array.from({ length: maxDataPoints }, () => null),
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.08)',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: 'Temperature (°C)',
                    data: Array.from({ length: maxDataPoints }, () => null),
                    borderColor: '#fbbf24',
                    backgroundColor: 'rgba(251, 191, 36, 0.08)',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'y2'
                },
                {
                    label: 'Vibration (mm/s)',
                    data: Array.from({ length: maxDataPoints }, () => null),
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.08)',
                    borderWidth: 2,
                    pointRadius: 0,
                    borderDash: [4, 4],
                    tension: 0.3,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#94a3b8',
                        usePointStyle: true,
                        boxWidth: 8,
                        font: { size: 11, family: 'Inter' }
                    }
                },
                tooltip: {
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderWidth: 1,
                    titleColor: '#f8fafc',
                    bodyColor: '#cbd5e1',
                    padding: 10,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            let val = context.parsed.y;
                            if (val !== null) {
                                return ` ${label}: ${val.toFixed(2)}`;
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(30, 41, 59, 0.5)' },
                    ticks: { display: false }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Pressure (bar)',
                        color: '#38bdf8',
                        font: { size: 11, weight: '600', family: 'Inter' }
                    },
                    grid: { color: 'rgba(30, 41, 59, 0.6)' },
                    ticks: { color: '#94a3b8', font: { size: 10 } },
                    suggestedMin: 180,
                    suggestedMax: 300,
                    grace: '8%'
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Vibration (mm/s)',
                        color: '#f43f5e',
                        font: { size: 11, weight: '600', family: 'Inter' }
                    },
                    grid: { display: false },
                    ticks: { color: '#f87171', font: { size: 10 } },
                    min: 0,
                    suggestedMax: 10,
                    grace: '15%'
                },
                y2: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Temp (°C)',
                        color: '#fbbf24',
                        font: { size: 11, weight: '600', family: 'Inter' }
                    },
                    grid: { display: false },
                    ticks: { color: '#fbbf24', font: { size: 10 } },
                    suggestedMin: 30,
                    suggestedMax: 70,
                    grace: '10%'
                }
            },
            animation: { duration: 0 }
        }
    });
}

function updateChart(pressure, temp, vibration) {
    if (!telemetryChart) return;

    const pDataset = telemetryChart.data.datasets[0].data;
    const tDataset = telemetryChart.data.datasets[1].data;
    const vDataset = telemetryChart.data.datasets[2].data;

    pDataset.push(pressure);
    pDataset.shift();
    tDataset.push(temp);
    tDataset.shift();
    vDataset.push(vibration);
    vDataset.shift();

    const validP = pDataset.filter(v => v !== null);
    const validT = tDataset.filter(v => v !== null);
    const validV = vDataset.filter(v => v !== null);

    if (validP.length > 0) {
        const minP = Math.min(...validP);
        const maxP = Math.max(...validP);
        telemetryChart.options.scales.y.suggestedMin = Math.min(180, Math.floor(minP - 15));
        telemetryChart.options.scales.y.suggestedMax = Math.max(300, Math.ceil(maxP + 10));
    }

    if (validV.length > 0) {
        const maxV = Math.max(...validV);
        telemetryChart.options.scales.y1.suggestedMax = Math.max(10, Math.ceil(maxV + 4));
    }

    if (validT.length > 0) {
        const maxT = Math.max(...validT);
        const minT = Math.min(...validT);
        telemetryChart.options.scales.y2.suggestedMin = Math.min(30, Math.floor(minT - 5));
        telemetryChart.options.scales.y2.suggestedMax = Math.max(70, Math.ceil(maxT + 10));
    }

    telemetryChart.update('none');
}

async function setMode(mode) {
    try {
        const res = await fetch('/api/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: mode })
        });
        const data = await res.json();
        updateModeUI(data.mode);
    } catch (e) {
        console.error("Failed to change mode", e);
    }
}

async function resetTelemetry() {
    try {
        await fetch('/api/reset', { method: 'POST' });
        updateModeUI('normal');
    } catch (e) {
        console.error("Failed to reset telemetry", e);
    }
}

async function forceAnalyze() {
    const btn = document.getElementById('btn-analyze-now');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Triggering...';
    }
    try {
        const res = await fetch('/api/analyze', { method: 'POST' });
        const result = await res.json();
        if (result.event_id) {
            selectedEventId = result.event_id;
        }
    } catch (e) {
        console.error("Failed to force analysis", e);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Analyze Now';
        }
    }
}

function updateModeUI(mode) {
    const btnNormal = document.getElementById('btn-mode-normal');
    const btnAnomaly = document.getElementById('btn-mode-anomaly');
    const stateBadge = document.getElementById('badge-machine-state');

    if (mode === 'normal') {
        if (btnNormal) {
            btnNormal.className = "px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white shadow-md transition-all";
        }
        if (btnAnomaly) {
            btnAnomaly.className = "px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all border border-slate-700";
        }
        if (stateBadge) {
            stateBadge.className = "badge-pill badge-success";
            stateBadge.innerHTML = '<span class="pulse-dot bg-emerald-400 animate-pulse"></span> Nominal Operation';
        }
    } else {
        if (btnNormal) {
            btnNormal.className = "px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all border border-slate-700";
        }
        if (btnAnomaly) {
            btnAnomaly.className = "px-3 py-2 rounded-lg text-xs font-semibold bg-rose-600 text-white shadow-md shadow-rose-900/40 transition-all";
        }
        if (stateBadge) {
            stateBadge.className = "badge-pill badge-danger";
            stateBadge.innerHTML = '<span class="pulse-dot bg-rose-400 animate-pulse"></span> Anomaly Simulated';
        }
    }
}

function renderTimeline(timeline, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !timeline) return;

    let html = '';
    timeline.forEach((step, idx) => {
        let statusBadge = '';
        let icon = '';
        let stepBorder = 'border-slate-800';

        if (step.status === 'Success') {
            statusBadge = '<span class="badge-pill badge-success"><i class="fa-solid fa-check text-[9px]"></i> Success</span>';
            icon = '<i class="fa-solid fa-circle-check text-emerald-400"></i>';
            stepBorder = 'border-emerald-900/40 bg-emerald-950/20';
        } else if (step.status === 'In Progress') {
            statusBadge = '<span class="badge-pill badge-info"><i class="fa-solid fa-spinner animate-spin text-[9px]"></i> In Progress</span>';
            icon = '<i class="fa-solid fa-arrows-rotate animate-spin text-sky-400"></i>';
            stepBorder = 'border-sky-800/60 bg-sky-950/30';
        } else if (step.status === 'Failed') {
            statusBadge = '<span class="badge-pill badge-danger"><i class="fa-solid fa-circle-xmark text-[9px]"></i> Failed</span>';
            icon = '<i class="fa-solid fa-circle-xmark text-rose-400"></i>';
            stepBorder = 'border-rose-900/50 bg-rose-950/20';
        } else {
            statusBadge = '<span class="badge-pill badge-neutral"><i class="fa-regular fa-clock text-[9px]"></i> Pending</span>';
            icon = '<i class="fa-regular fa-circle text-slate-500"></i>';
            stepBorder = 'border-slate-800/80 bg-slate-900/40';
        }

        html += `
            <div class="flex-1 min-w-[170px] p-3 rounded-lg border ${stepBorder} flex flex-col justify-between transition-all">
                <div class="flex items-center justify-between gap-2 mb-2">
                    <div class="flex items-center gap-2">
                        ${icon}
                        <span class="text-xs font-bold text-slate-200 tracking-tight">${step.step}</span>
                    </div>
                    ${statusBadge}
                </div>
                <div class="text-[11px] text-slate-400 break-words-anywhere font-mono leading-tight">
                    ${step.detail || 'Awaiting stage trigger...'}
                </div>
                <div class="text-[10px] text-slate-500 font-mono mt-2 pt-1 border-t border-slate-800/60 flex justify-between">
                    <span>Step ${idx + 1}</span>
                    <span>${step.timestamp || '--:--:--'}</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderExecutionTrace(event) {
    if (!event) return;
    currentEventData = event;

    const traceHeaderId = document.getElementById('trace-event-id');
    const traceTimestamp = document.getElementById('trace-timestamp');
    const traceStatus = document.getElementById('trace-status');

    if (traceHeaderId) traceHeaderId.innerText = `Event #${event.id}`;
    if (traceTimestamp) traceTimestamp.innerText = event.timestamp || '';
    if (traceStatus) {
        if (event.stage === 'completed') {
            traceStatus.className = 'badge-pill badge-success';
            traceStatus.innerText = 'Completed';
        } else if (event.stage === 'failed') {
            traceStatus.className = 'badge-pill badge-danger';
            traceStatus.innerText = 'Failed';
        } else {
            traceStatus.className = 'badge-pill badge-info';
            traceStatus.innerText = 'Analyzing';
        }
    }

    const snapP = document.getElementById('trace-snap-pressure');
    const snapT = document.getElementById('trace-snap-temp');
    const snapV = document.getElementById('trace-snap-vib');
    const snapMode = document.getElementById('trace-snap-mode');
    const snapTriggerReason = document.getElementById('trace-trigger-reason');

    if (event.sensor_snapshot) {
        if (snapP) snapP.innerText = `${event.sensor_snapshot.pressure.toFixed(1)} bar`;
        if (snapT) snapT.innerText = `${event.sensor_snapshot.temperature.toFixed(1)} °C`;
        if (snapV) snapV.innerText = `${event.sensor_snapshot.vibration.toFixed(2)} mm/s`;
    }
    if (snapMode) {
        snapMode.innerText = event.machine_state ? event.machine_state.toUpperCase() : 'NORMAL';
        snapMode.className = event.machine_state === 'anomaly' ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold';
    }
    if (snapTriggerReason && event.threshold_evaluation) {
        const reasons = event.threshold_evaluation.reasons || [];
        snapTriggerReason.innerHTML = reasons.map(r => `<div><i class="fa-solid fa-triangle-exclamation text-amber-400 text-xs mr-1"></i> ${r}</div>`).join('') || 'Nominal operational range';
    }

    const alloyStatus = document.getElementById('trace-alloy-status');
    const alloyDuration = document.getElementById('trace-alloy-duration');
    const alloySql = document.getElementById('trace-alloy-sql');
    const alloyRole = document.getElementById('trace-alloy-role');
    const alloyTarget = document.getElementById('trace-alloy-target');
    const alloyError = document.getElementById('trace-alloy-error');

    if (event.alloydb) {
        if (alloyStatus) {
            alloyStatus.className = event.alloydb.status === 'Success' ? 'badge-pill badge-success' : (event.alloydb.status === 'Failed' ? 'badge-pill badge-danger' : 'badge-pill badge-neutral');
            alloyStatus.innerText = event.alloydb.status || 'Pending';
        }
        if (alloyDuration) {
            alloyDuration.innerText = event.alloydb.duration_ms ? `${event.alloydb.duration_ms} ms` : (event.alloydb.connect_duration_ms ? `Conn: ${event.alloydb.connect_duration_ms} ms` : '--');
        }
        if (alloyTarget) alloyTarget.innerText = event.alloydb.target || 'AlloyDB Omni';
        if (alloyRole) alloyRole.innerText = event.alloydb.architecture_role || '';
        if (alloySql) alloySql.innerText = event.alloydb.sql_query || '-- SQL Statement not generated yet --';
        if (alloyError) {
            if (event.alloydb.error) {
                alloyError.classList.remove('hidden');
                alloyError.innerText = event.alloydb.error;
            } else {
                alloyError.classList.add('hidden');
            }
        }
    }

    const gemmaStatus = document.getElementById('trace-gemma-status');
    const gemmaDuration = document.getElementById('trace-gemma-duration');
    const gemmaTokens = document.getElementById('trace-gemma-tokens');
    const gemmaPrompt = document.getElementById('trace-gemma-prompt');
    const gemmaRequestJson = document.getElementById('trace-gemma-request');
    const gemmaRawResponse = document.getElementById('trace-gemma-raw-response');
    const gemmaError = document.getElementById('trace-gemma-error');

    if (event.gemma) {
        if (gemmaStatus) {
            gemmaStatus.className = event.gemma.status === 'Success' ? 'badge-pill badge-success' : (event.gemma.status === 'Failed' ? 'badge-pill badge-danger' : 'badge-pill badge-neutral');
            gemmaStatus.innerText = event.gemma.status || 'Pending';
        }
        if (gemmaDuration) {
            gemmaDuration.innerText = event.gemma.eval_duration_ms ? `${event.gemma.eval_duration_ms} ms` : (event.gemma.inference_duration_ms ? `${event.gemma.inference_duration_ms} ms` : '--');
        }
        if (gemmaTokens) {
            const promptTok = event.gemma.prompt_tokens || 0;
            const evalTok = event.gemma.eval_tokens || 0;
            gemmaTokens.innerText = `Prompt: ${promptTok} | Generated: ${evalTok}`;
        }
        if (gemmaPrompt) gemmaPrompt.innerText = event.gemma.prompt || '-- Awaiting prompt generation --';
        if (gemmaRequestJson) {
            gemmaRequestJson.innerText = JSON.stringify(event.gemma.request_payload || {}, null, 2);
        }
        if (gemmaRawResponse) {
            gemmaRawResponse.innerText = event.gemma.raw_response ? JSON.stringify(event.gemma.raw_response, null, 2) : '-- Response payload pending --';
        }
        if (gemmaError) {
            if (event.gemma.error) {
                gemmaError.classList.remove('hidden');
                gemmaError.innerText = event.gemma.error;
            } else {
                gemmaError.classList.add('hidden');
            }
        }
    }

    const finalRaw = document.getElementById('trace-final-raw');
    const finalThreshold = document.getElementById('trace-final-threshold');
    const finalExplanation = document.getElementById('trace-final-explanation');
    const finalCard = document.getElementById('trace-final-card');

    if (event.sensor_snapshot && finalRaw) {
        finalRaw.innerHTML = `
            <div class="flex justify-between py-1 border-b border-slate-800 font-mono text-xs">
                <span class="text-slate-400">Pressure:</span>
                <span class="text-sky-300 font-bold">${event.sensor_snapshot.pressure.toFixed(1)} bar</span>
            </div>
            <div class="flex justify-between py-1 border-b border-slate-800 font-mono text-xs">
                <span class="text-slate-400">Temperature:</span>
                <span class="text-amber-300 font-bold">${event.sensor_snapshot.temperature.toFixed(1)} °C</span>
            </div>
            <div class="flex justify-between py-1 font-mono text-xs">
                <span class="text-slate-400">Vibration Z:</span>
                <span class="text-rose-300 font-bold">${event.sensor_snapshot.vibration.toFixed(2)} mm/s</span>
            </div>
        `;
    }

    if (event.threshold_evaluation && finalThreshold) {
        const reasons = event.threshold_evaluation.reasons || [];
        finalThreshold.innerHTML = reasons.map(r => `
            <div class="p-1.5 rounded bg-rose-950/30 border border-rose-900/50 text-[11px] text-rose-300 font-mono">
                <i class="fa-solid fa-triangle-exclamation mr-1 text-rose-400"></i> ${r}
            </div>
        `).join('') || '<div class="text-emerald-400 text-xs font-mono">No threshold violations detected</div>';
    }

    if (finalExplanation) {
        if (event.final_result && event.final_result.explanation) {
            finalExplanation.innerHTML = `
                <div class="text-slate-100 text-sm font-semibold leading-relaxed break-words-anywhere">
                    ${event.final_result.explanation}
                </div>
            `;
            if (finalCard) finalCard.classList.remove('glow-red');
        } else if (event.final_result && event.final_result.error) {
            finalExplanation.innerHTML = `
                <div class="text-rose-400 text-xs font-mono break-words-anywhere">
                    <i class="fa-solid fa-circle-exclamation mr-1"></i> ${event.final_result.error}
                </div>
            `;
            if (finalCard) finalCard.classList.add('glow-red');
        } else {
            finalExplanation.innerHTML = `
                <div class="text-slate-500 text-xs font-mono italic">
                    <i class="fa-solid fa-spinner animate-spin mr-1"></i> Inference in progress...
                </div>
            `;
        }
    }
}

async function loadHistoricalEvent(eventId) {
    selectedEventId = eventId;
    try {
        const res = await fetch(`/api/events/${eventId}`);
        if (res.ok) {
            const event = await res.json();
            renderExecutionTrace(event);
            if (event.timeline) {
                renderTimeline(event.timeline, 'execution-timeline-steps');
            }
        }
    } catch (e) {
        console.error("Failed to fetch historical event", e);
    }
}

async function renderEventsList() {
    const listContainer = document.getElementById('events-history-list');
    if (!listContainer) return;

    try {
        const res = await fetch('/api/events');
        if (!res.ok) return;
        const events = await res.json();

        if (events.length === 0) {
            listContainer.innerHTML = '<div class="text-xs text-slate-500 italic p-3">No AI events recorded yet.</div>';
            return;
        }

        let html = '';
        events.forEach(e => {
            const isSelected = selectedEventId === e.id;
            const badgeClass = e.stage === 'completed' ? 'badge-success' : (e.stage === 'failed' ? 'badge-danger' : 'badge-info');
            const itemBg = isSelected ? 'bg-slate-800 border-sky-500' : 'bg-slate-900/60 border-slate-800 hover:border-slate-700';

            html += `
                <div onclick="loadHistoricalEvent('${e.id}')" class="p-2.5 rounded-lg border ${itemBg} cursor-pointer transition-all flex flex-col gap-1.5">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-mono font-bold text-slate-200">#${e.id}</span>
                        <span class="badge-pill ${badgeClass} text-[9px]">${e.stage}</span>
                    </div>
                    <div class="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                        <span><i class="fa-regular fa-clock text-[10px] mr-1"></i>${e.timestamp}</span>
                        <span class="text-slate-500 text-[10px]">${e.trigger_type}</span>
                    </div>
                    <div class="text-[11px] text-slate-300 truncate font-mono">
                        ${e.final_result && e.final_result.explanation ? e.final_result.explanation : (e.final_result && e.final_result.error ? e.final_result.error : 'Processing...')}
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;
    } catch (e) {
        console.error("Failed to render events list", e);
    }
}

function copyToClipboard(elementId, btnElement) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.innerText;
    navigator.clipboard.writeText(text).then(() => {
        if (btnElement) {
            const orig = btnElement.innerHTML;
            btnElement.innerHTML = '<i class="fa-solid fa-check text-emerald-400"></i> Copied';
            setTimeout(() => {
                btnElement.innerHTML = orig;
            }, 1800);
        }
    });
}

async function pollTelemetry() {
    try {
        const res = await fetch('/api/stream');
        if (!res.ok) return;
        const data = await res.json();

        const pVal = document.getElementById('val-pressure');
        const tVal = document.getElementById('val-temp');
        const vVal = document.getElementById('val-vib');

        const cardP = document.getElementById('card-pressure');
        const cardT = document.getElementById('card-temp');
        const cardV = document.getElementById('card-vib');

        if (pVal) pVal.innerText = data.pressure.toFixed(1);
        if (tVal) tVal.innerText = data.temperature.toFixed(1);
        if (vVal) vVal.innerText = data.vibration.toFixed(2);

        updateChart(data.pressure, data.temperature, data.vibration);
        updateModeUI(data.state);

        if (cardP) {
            if (data.pressure < data.thresholds.pressure_min || data.pressure > data.thresholds.pressure_max) {
                cardP.classList.add('glow-red');
            } else {
                cardP.classList.remove('glow-red');
            }
        }
        if (cardT) {
            if (data.temperature > data.thresholds.temperature_max) {
                cardT.classList.add('glow-amber');
            } else {
                cardT.classList.remove('glow-amber');
            }
        }
        if (cardV) {
            if (data.vibration > data.thresholds.vibration_max) {
                cardV.classList.add('glow-red');
            } else {
                cardV.classList.remove('glow-red');
            }
        }

        const skipBanner = document.getElementById('skip-status-banner');
        const skipReasonText = document.getElementById('skip-reason-text');
        const cooldownIndicator = document.getElementById('cooldown-indicator');

        if (data.is_analyzing) {
            if (skipBanner) skipBanner.className = "flex items-center justify-between p-3 rounded-lg border border-sky-800/80 bg-sky-950/40 text-xs";
            if (skipReasonText) {
                skipReasonText.innerHTML = '<i class="fa-solid fa-spinner animate-spin text-sky-400 mr-2"></i><strong>In-Database Inference Running:</strong> AlloyDB Omni query in progress via google_ml.predict_row...';
            }
            if (cooldownIndicator) cooldownIndicator.innerText = 'Active';
        } else if (data.skip_info) {
            const isAnomaly = data.skip_info.anomaly_active;
            const remaining = data.cooldown_remaining;
            if (skipBanner) {
                skipBanner.className = isAnomaly ? "flex items-center justify-between p-3 rounded-lg border border-amber-800/80 bg-amber-950/30 text-xs" : "flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-900/60 text-xs";
            }
            if (skipReasonText) {
                const icon = isAnomaly ? '<i class="fa-solid fa-hourglass-half text-amber-400 mr-2"></i>' : '<i class="fa-solid fa-circle-check text-emerald-400 mr-2"></i>';
                skipReasonText.innerHTML = `${icon}<span>${data.skip_info.reason}</span>`;
            }
            if (cooldownIndicator) {
                cooldownIndicator.innerText = remaining > 0 ? `${remaining}s cooldown` : 'Ready';
            }
        }

        if (data.latest_event) {
            if (!selectedEventId || selectedEventId === data.latest_event.id || !lastKnownEventId || lastKnownEventId !== data.latest_event.id) {
                selectedEventId = data.latest_event.id;
                renderExecutionTrace(data.latest_event);
                if (data.latest_event.timeline) {
                    renderTimeline(data.latest_event.timeline, 'execution-timeline-steps');
                }
            }
            lastKnownEventId = data.latest_event.id;
        }

        renderEventsList();
    } catch (e) {
        console.error("Stream polling error:", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initChart();
    pollTelemetry();
    setInterval(pollTelemetry, 1000);
});
