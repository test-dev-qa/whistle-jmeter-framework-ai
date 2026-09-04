'use strict';
// Stress test UI — extracted from index.html

        let stressPollTimer = null;
        let stressPollInFlight = false;
        let stressBaselineId = '';
        let lastStressCompareResult = null;
        let stressReportItems = [];

        function clampStress(name, value) {
            const n = Number(value);
            if (name === 'users') return Math.min(5000, Math.max(1, Math.trunc(Number.isFinite(n) ? n : 10)));
            if (name === 'durationMin') return Math.min(60, Math.max(1, Math.trunc(Number.isFinite(n) ? n : 1)));
            return Math.min(30, Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0)));
        }

        function syncStressField(name, value) {
            const v = clampStress(name, value);
            if (name === 'users') {
                document.getElementById('stressUsers').value = v;
                document.getElementById('stressUsersRange').value = v;
            } else if (name === 'durationMin') {
                document.getElementById('stressDuration').value = v;
                document.getElementById('stressDurationRange').value = v;
            } else {
                document.getElementById('stressRamp').value = v;
                document.getElementById('stressRampRange').value = v;
            }
        }

        function collectStressConfig() {
            return {
                users: clampStress('users', document.getElementById('stressUsers').value),
                durationMin: clampStress('durationMin', document.getElementById('stressDuration').value),
                rampUpMin: clampStress('rampUpMin', document.getElementById('stressRamp').value)
            };
        }

        function applyStressConfig(cfg) {
            const data = cfg || {};
            syncStressField('users', data.users);
            syncStressField('durationMin', data.durationMin);
            syncStressField('rampUpMin', data.rampUpMin);
        }

        function formatStressResult(data) {
            if (!data) return '尚未开始';
            const r = data.result || {};
            const lines = [];
            const statusMap = {
                idle: '空闲',
                running: '运行中',
                stopping: '停止中',
                stopped: '已停止',
                finished: '已完成',
                failed: '失败'
            };
            lines.push('状态：' + (statusMap[data.status] || data.status || '-'));
            if (data.recordCount != null) lines.push('接口数：' + data.recordCount);
            if (data.config) {
                lines.push('并发 ' + data.config.users + ' / 时长 ' + data.config.durationMin + ' 分钟 / 爬坡 ' + data.config.rampUpMin + ' 分钟');
            }
            if (data.postOps && data.postOps.enabled) {
                lines.push('后置操作：提取 ' + (data.postOps.extracts || 0) +
                    ' / 断言 ' + (data.postOps.asserts || 0) +
                    ' / 数据库 ' + (data.postOps.dbops || 0));
            }
            if (data.progress) lines.push('进度：' + (data.progress.percent || 0) + '%');
            if (r.total != null) {
                lines.push('请求：' + r.total + '（成功 ' + r.success + ' / 失败 ' + r.failed + '，成功率 ' + r.successRate + '%）');
                lines.push('RPS：' + r.rps + '　平均延迟：' + r.avgLatencyMs + 'ms　P50：' + r.p50LatencyMs + 'ms　P95：' + r.p95LatencyMs + 'ms');
                if (r.dbTotal) {
                    lines.push('DB：' + r.dbTotal + ' 次　平均 ' + (r.avgDbLatencyMs || 0) + 'ms　P90 ' + (r.p90DbLatencyMs || 0) + 'ms');
                }
            }
            if (r.lastError) lines.push('最近错误：' + r.lastError);
            if (data.error) lines.push('错误：' + data.error);
            return lines.join('\n');
        }

        function renderStressStatus(data) {
            const running = data && (data.status === 'running' || data.status === 'stopping');
            const modalOpen = !document.getElementById('stressModal').hidden;
            if (!modalOpen) return;
            document.getElementById('stressResult').textContent = formatStressResult(data);
            document.getElementById('stressStopBtn').hidden = !running;
            document.getElementById('stressRunBtn').disabled = Boolean(running);
            if (running) {
                document.getElementById('stressStatus').textContent = '压测进行中… 活跃用户 ' + (data.activeUsers || 0);
            } else if (data && data.reportSaved && data.lastReportId && (data.status === 'finished' || data.status === 'stopped')) {
                document.getElementById('stressStatus').textContent = '报告已保存，可点击「测试报告」查看';
            } else if (data && data.error && (data.status === 'finished' || data.status === 'stopped' || data.status === 'failed')) {
                document.getElementById('stressStatus').textContent = data.error;
            } else {
                document.getElementById('stressStatus').textContent = '';
            }
        }

        function stopStressPoll() {
            if (stressPollTimer) {
                clearInterval(stressPollTimer);
                stressPollTimer = null;
            }
            stressPollInFlight = false;
        }

        function startStressPoll() {
            if (stressPollTimer) return;
            stressPollTimer = setInterval(async () => {
                if (stressPollInFlight) return;
                stressPollInFlight = true;
                try {
                    const res = await fetch('./api/stress/status');
                    const result = await res.json();
                    if (!res.ok || result.code !== 0) return;
                    renderStressStatus(result.data);
                    if (result.data && result.data.status !== 'running' && result.data.status !== 'stopping') {
                        stopStressPoll();
                    }
                } catch (e) {
                    // ignore poll errors
                } finally {
                    stressPollInFlight = false;
                }
            }, 1000);
        }

        async function openStressModal() {
            const ids = getCheckedIds();
            document.getElementById('stressSelectedHint').textContent = ids.length
                ? ('已勾选 ' + ids.length + ' 条请求，将按顺序循环回放。')
                : '尚未勾选请求：运行时将提示先勾选；也可先保存参数。';
            document.getElementById('stressModal').hidden = false;
            document.getElementById('stressStatus').textContent = '';
            try {
                const [cfgRes, stRes] = await Promise.all([
                    fetch('./api/stress/config'),
                    fetch('./api/stress/status')
                ]);
                const cfg = await cfgRes.json();
                const st = await stRes.json();
                if (cfgRes.ok && cfg.code === 0) applyStressConfig(cfg.data);
                if (stRes.ok && st.code === 0) {
                    renderStressStatus(st.data);
                    if (st.data && (st.data.status === 'running' || st.data.status === 'stopping')) startStressPoll();
                } else {
                    renderStressStatus(null);
                }
            } catch (e) {
                document.getElementById('stressStatus').textContent = e.message || '读取压测配置失败';
            }
        }

        function closeStressModal() {
            document.getElementById('stressModal').hidden = true;
            fetch('./api/stress/status').then((res) => res.json()).then((result) => {
                if (result && result.code === 0 && result.data &&
                    (result.data.status === 'running' || result.data.status === 'stopping')) {
                    if (!stressPollTimer) startStressPoll();
                } else {
                    stopStressPoll();
                }
            }).catch(() => stopStressPoll());
        }

        async function saveStressConfig() {
            const status = document.getElementById('stressStatus');
            status.textContent = '保存中…';
            try {
                const res = await fetch('./api/stress/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(collectStressConfig())
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                applyStressConfig(result.data);
                status.textContent = result.msg || '已保存';
            } catch (e) {
                status.textContent = e.message || '保存失败';
            }
        }

        async function runStressTest() {
            const status = document.getElementById('stressStatus');
            const ids = getCheckedIds();
            if (!ids.length) {
                status.textContent = '请先勾选要压测回放的录制请求';
                return;
            }
            const payload = Object.assign({ ids }, collectStressConfig());
            status.textContent = '正在启动压测…';
            try {
                const res = await fetch('./api/stress/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '启动失败');
                renderStressStatus(result.data);
                startStressPoll();
                status.textContent = result.msg || '压测已启动';
            } catch (e) {
                status.textContent = e.message || '启动失败';
            }
        }

        async function stopStressTest() {
            const status = document.getElementById('stressStatus');
            try {
                const res = await fetch('./api/stress/stop', { method: 'POST' });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '停止失败');
                renderStressStatus(result.data);
                status.textContent = result.msg || '已请求停止';
            } catch (e) {
                status.textContent = e.message || '停止失败';
            }
        }

        let currentStressReportId = '';
        let currentStressReport = null;
        let stressExecutionFilter = 'all';
        let stressExecutionPage = 1;
        let stressExecutionPageSize = 50;
        let stressExecutionPageTotal = 1;

        function formatReportTime(ts) {
            if (ts == null || ts === '') return '-';
            if (typeof ts === 'string' && Number.isNaN(Number(ts))) {
                const parsed = Date.parse(ts);
                if (!Number.isNaN(parsed)) {
                    try { return new Date(parsed).toLocaleString(); } catch (e) { return ts; }
                }
                return ts;
            }
            const n = Number(ts);
            if (!Number.isFinite(n) || n <= 0) return '-';
            try {
                return new Date(n).toLocaleString();
            } catch (e) {
                return String(ts);
            }
        }

        function sanitizeHttpMethod(value) {
            const method = String(value || 'GET').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || 'GET';
            const known = { GET: 1, POST: 1, PUT: 1, DELETE: 1, PATCH: 1, HEAD: 1, OPTIONS: 1 };
            return { method, css: known[method] ? method : 'GET' };
        }

        function formatReportOption(item) {
            const s = item.summary || {};
            const c = item.config || {};
            const pin = item.id && item.id === stressBaselineId ? '📌 ' : '';
            return pin + [
                formatReportTime(item.startedAt || item.createdAt),
                '并发' + (c.users || 0),
                (s.total || 0) + '次',
                'RPS ' + (s.rps || 0),
                item.status || ''
            ].join(' · ');
        }

        function applyStressBaselineFromApi(data) {
            const baseline = data && data.baseline ? data.baseline : data;
            stressBaselineId = baseline && baseline.reportId ? baseline.reportId : '';
            updateStressBaselineButton();
        }

        function updateStressBaselineButton() {
            const btn = document.getElementById('stressBaselineBtn');
            if (!btn) return;
            const isCurrent = Boolean(currentStressReportId && currentStressReportId === stressBaselineId);
            btn.textContent = isCurrent ? '取消基线' : '设为基线';
            btn.title = isCurrent
                ? '当前报告已固定为对比基线'
                : '将当前报告固定为对比基线，打开「对比报告」时自动选中';
            btn.disabled = !currentStressReportId;
        }

        async function toggleStressBaseline() {
            const status = document.getElementById('stressReportStatus');
            if (!currentStressReportId) {
                status.textContent = '请先选择一份报告';
                return;
            }
            const isCurrent = currentStressReportId === stressBaselineId;
            status.textContent = isCurrent ? '取消基线中…' : '设置基线中…';
            try {
                const res = await fetch('./api/stress/baseline', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(isCurrent ? { clear: true } : { reportId: currentStressReportId })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '操作失败');
                applyStressBaselineFromApi(result.data);
                const select = document.getElementById('stressReportSelect');
                if (select && stressReportItems.length) {
                    const current = select.value;
                    select.innerHTML = stressReportItems.map((item) => (
                        `<option value="${escapeHtml(item.id)}">${escapeHtml(formatReportOption(item))}</option>`
                    )).join('');
                    select.value = current;
                }
                status.textContent = result.msg || (isCurrent ? '已取消基线' : '已设为基线');
            } catch (e) {
                status.textContent = e.message || '操作失败';
            }
        }

        function formatChartClock(ts) {
            const n = Number(ts);
            if (!Number.isFinite(n) || n <= 0) return '';
            const d = new Date(n);
            const pad = (x) => String(x).padStart(2, '0');
            return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        }

        function formatChartFullTime(ts) {
            const n = Number(ts);
            if (!Number.isFinite(n) || n <= 0) return '-';
            const d = new Date(n);
            const pad = (x) => String(x).padStart(2, '0');
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        }

        function niceAxisMax(value, minFloor) {
            const floor = minFloor == null ? 1 : minFloor;
            const v = Math.max(Number(value) || 0, floor);
            if (v <= 1) return 1;
            const exp = Math.floor(Math.log10(v));
            const pow = Math.pow(10, exp);
            const n = v / pow;
            const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
            return Number((nice * pow).toFixed(6));
        }

        function formatAxisNumber(v) {
            const n = Number(v) || 0;
            if (n >= 100) return String(Math.round(n));
            if (n >= 10) return String(Math.round(n * 10) / 10);
            return String(Math.round(n * 100) / 100);
        }

        let reportChartSeries = [];
        let reportChartLayout = null;
        let reportChartSourceSeries = [];

        function measureReportChartViewSize(canvasId) {
            const canvas = document.getElementById(canvasId || 'reportChartCanvas');
            const cw = canvas && canvas.clientWidth ? canvas.clientWidth : 0;
            const ch = canvas && canvas.clientHeight ? canvas.clientHeight : 0;
            const H = canvasId === 'reportChartFsCanvas' ? 520 : 300;
            if (cw <= 0 || ch <= 0) return { W: canvasId === 'reportChartFsCanvas' ? 1400 : 1100, H };
            const W = Math.min(1800, Math.max(900, Math.round(H * (cw / Math.max(ch, 1)))));
            return { W, H };
        }

        function buildReportChartModel(series, size) {
            const points = Array.isArray(series) ? series.slice() : [];
            const W = size && size.W ? size.W : 1100;
            const H = size && size.H ? size.H : 300;
            // 底部仅留刻度短线；时间文字改由 HTML 轴展示，避免被父级 overflow 裁切
            const pad = { l: 58, r: 132, t: 12, b: 18 };
            const plotW = W - pad.l - pad.r;
            const plotH = H - pad.t - pad.b;
            const maxRps = niceAxisMax(Math.max(0, ...points.map((p) => Number(p.rps) || 0)), 1);
            const maxRt = niceAxisMax(Math.max(0, ...points.map((p) => Number(p.avgLatencyMs) || 0)), 1);
            const maxFail = 100;
            const maxVu = niceAxisMax(Math.max(0, ...points.map((p) => Number(p.concurrentUsers) || 0)), 1);
            const xAt = (i) => pad.l + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
            const yScale = (v, max) => pad.t + plotH - (Math.min(max, Math.max(0, Number(v) || 0)) / max) * plotH;
            return { points, W, H, pad, plotW, plotH, maxRps, maxRt, maxFail, maxVu, xAt, yScale };
        }

        function pickChartTimeLabelIndexes(len, count) {
            const n = Math.min(count, len);
            if (n <= 0) return [];
            if (n === 1) return [0];
            const out = [];
            for (let i = 0; i < n; i += 1) {
                out.push(Math.round(i * (len - 1) / (n - 1)));
            }
            return out;
        }

        function renderReportChartTimeAxis(points, elId) {
            const el = document.getElementById(elId || 'reportChartTimeAxis');
            if (!el) return;
            const list = Array.isArray(points) ? points : [];
            if (!list.length) {
                el.innerHTML = '';
                return;
            }
            const idxs = pickChartTimeLabelIndexes(list.length, Math.min(8, list.length));
            el.innerHTML = idxs.map((idx) =>
                '<span title="' + escapeHtml(formatChartFullTime(list[idx].ts)) + '">' +
                escapeHtml(formatChartClock(list[idx].ts)) + '</span>'
            ).join('');
        }

        function buildReportChartSvgMarkup(series, options) {
            const opts = options || {};
            const size = opts.size || measureReportChartViewSize(opts.canvasId);
            const model = buildReportChartModel(series, size);
            const { points, pad, plotW, plotH, maxRps, maxRt, maxFail, maxVu, xAt, yScale } = model;
            const idPrefix = opts.idPrefix || '';
            if (!points.length) {
                return {
                    markup: '<text x="40" y="160" fill="#90a4ae" font-size="14">暂无趋势数据</text>',
                    model: null
                };
            }

            const ticks = 10;
            const grid = [];
            const leftLabels = [];
            const rightRtLabels = [];
            const rightRpsLabels = [];
            const axisBaseY = pad.t + plotH;
            for (let i = 0; i <= ticks; i += 1) {
                const ratio = i / ticks;
                const y = axisBaseY - ratio * plotH;
                grid.push(`<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${(pad.l + plotW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#f0f2f5" stroke-width="1" />`);
                leftLabels.push(
                    `<text x="${(pad.l - 8).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#90a4ae" font-size="11">${Math.round(ratio * maxFail)}%</text>`
                );
                rightRtLabels.push(
                    `<text x="${(pad.l + plotW + 8).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="start" fill="#42a5f5" font-size="11">${formatAxisNumber(ratio * maxRt)}ms</text>`
                );
                rightRpsLabels.push(
                    `<text x="${(pad.l + plotW + 58).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="start" fill="#ff9800" font-size="11">${formatAxisNumber(ratio * maxRps)}req/s</text>`
                );
            }

            const xLabelCount = Math.min(8, points.length);
            const xTicks = [];
            pickChartTimeLabelIndexes(points.length, xLabelCount).forEach((idx) => {
                const x = xAt(idx);
                xTicks.push(
                    `<line x1="${x.toFixed(1)}" y1="${axisBaseY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(axisBaseY + 6).toFixed(1)}" stroke="#90a4ae" stroke-width="1" />`
                );
            });

            const pathLine = (key, max, color, width) => {
                const d = points.map((p, i) => {
                    const x = xAt(i).toFixed(1);
                    const y = yScale(p[key], max).toFixed(1);
                    return (i === 0 ? 'M' : 'L') + x + ' ' + y;
                }).join(' ');
                return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width || 2}" stroke-linejoin="round" stroke-linecap="round" />`;
            };

            const vuTop = points.map((p, i) => {
                const x = xAt(i).toFixed(1);
                const y = yScale(p.concurrentUsers, maxVu).toFixed(1);
                return (i === 0 ? 'M' : 'L') + x + ' ' + y;
            }).join(' ');
            const vuArea = vuTop +
                ` L${xAt(points.length - 1).toFixed(1)} ${axisBaseY.toFixed(1)}` +
                ` L${xAt(0).toFixed(1)} ${axisBaseY.toFixed(1)} Z`;

            const crosshair = opts.withCrosshair
                ? [
                    `<line id="${idPrefix}reportChartVLine" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${axisBaseY}" stroke="#90a4ae" stroke-width="1" stroke-dasharray="4 3" opacity="0" />`,
                    `<g id="${idPrefix}reportChartDots" opacity="0">`,
                    `<circle id="${idPrefix}dotRps" r="4" fill="#ff9800" stroke="#fff" stroke-width="1.5" />`,
                    `<circle id="${idPrefix}dotRt" r="4" fill="#42a5f5" stroke="#fff" stroke-width="1.5" />`,
                    `<circle id="${idPrefix}dotFail" r="4" fill="#ef5350" stroke="#fff" stroke-width="1.5" />`,
                    `<circle id="${idPrefix}dotVu" r="4" fill="#90a4ae" stroke="#fff" stroke-width="1.5" />`,
                    `</g>`
                  ].join('')
                : '';

            const markup = [
                `<rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="#fafbfc" />`,
                grid.join(''),
                `<path d="${vuArea}" fill="rgba(144,164,174,0.22)" stroke="none" />`,
                pathLine('concurrentUsers', maxVu, '#90a4ae', 1.5),
                pathLine('rps', maxRps, '#ff9800', 2),
                pathLine('avgLatencyMs', maxRt, '#42a5f5', 2),
                pathLine('failRate', maxFail, '#ef5350', 2),
                `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${axisBaseY}" stroke="#cfd8dc" />`,
                `<line x1="${pad.l + plotW}" y1="${pad.t}" x2="${pad.l + plotW}" y2="${axisBaseY}" stroke="#cfd8dc" />`,
                `<line x1="${pad.l}" y1="${axisBaseY}" x2="${(pad.l + plotW).toFixed(1)}" y2="${axisBaseY}" stroke="#546e7a" stroke-width="1.5" />`,
                leftLabels.join(''),
                rightRtLabels.join(''),
                rightRpsLabels.join(''),
                xTicks.join(''),
                crosshair
            ].join('');

            return { markup, model };
        }

        function hideReportChartTooltip(prefix) {
            const p = prefix || '';
            const tip = document.getElementById(p === 'fs' ? 'reportChartFsTooltip' : 'reportChartTooltip');
            if (tip) tip.hidden = true;
            const vline = document.getElementById(p + 'reportChartVLine');
            const dots = document.getElementById(p + 'reportChartDots');
            if (vline) vline.setAttribute('opacity', '0');
            if (dots) dots.setAttribute('opacity', '0');
        }

        function updateReportChartHover(index, ctx) {
            const c = ctx || {
                layout: reportChartLayout,
                series: reportChartSeries,
                prefix: '',
                tipId: 'reportChartTooltip',
                canvasId: 'reportChartCanvas',
                svgId: 'reportChart'
            };
            if (!c.layout || !c.series.length) return;
            const i = Math.max(0, Math.min(c.series.length - 1, index));
            const p = c.series[i];
            const { xAt, yScale, maxRps, maxRt, maxFail, maxVu, pad, plotH } = c.layout;
            const x = xAt(i);
            const vline = document.getElementById(c.prefix + 'reportChartVLine');
            const dots = document.getElementById(c.prefix + 'reportChartDots');
            if (vline) {
                vline.setAttribute('x1', x.toFixed(1));
                vline.setAttribute('x2', x.toFixed(1));
                vline.setAttribute('y1', String(pad.t));
                vline.setAttribute('y2', String(pad.t + plotH));
                vline.setAttribute('opacity', '1');
            }
            if (dots) {
                dots.setAttribute('opacity', '1');
                const setDot = (id, key, max) => {
                    const el = document.getElementById(c.prefix + id);
                    if (!el) return;
                    el.setAttribute('cx', x.toFixed(1));
                    el.setAttribute('cy', yScale(p[key], max).toFixed(1));
                };
                setDot('dotRps', 'rps', maxRps);
                setDot('dotRt', 'avgLatencyMs', maxRt);
                setDot('dotFail', 'failRate', maxFail);
                setDot('dotVu', 'concurrentUsers', maxVu);
            }

            const tip = document.getElementById(c.tipId);
            const canvas = document.getElementById(c.canvasId);
            if (!tip || !canvas) return;
            tip.hidden = false;
            tip.innerHTML = [
                '<div class="tt-time">' + escapeHtml(formatChartFullTime(p.ts)) + '</div>',
                '<div class="tt-row"><span class="k"><span class="dot" style="background:#ff9800"></span>每秒接口请求数</span><span class="v">' + (Number(p.rps) || 0) + '</span></div>',
                '<div class="tt-row"><span class="k"><span class="dot" style="background:#42a5f5"></span>平均响应时间</span><span class="v">' + (Number(p.avgLatencyMs) || 0) + ' ms</span></div>',
                '<div class="tt-row"><span class="k"><span class="dot" style="background:#ef5350"></span>请求失败率</span><span class="v">' + Number(p.failRate || 0).toFixed(2) + '%</span></div>',
                '<div class="tt-row"><span class="k"><span class="dot" style="background:#90a4ae"></span>并发用户数</span><span class="v">' + (Number(p.concurrentUsers) || 0) + '</span></div>'
            ].join('');

            const svg = document.getElementById(c.svgId);
            const rect = canvas.getBoundingClientRect();
            const svgRect = svg.getBoundingClientRect();
            const ratioX = svgRect.width / c.layout.W;
            const left = (svgRect.left - rect.left) + x * ratioX + 12;
            const top = 24;
            tip.style.left = Math.min(Math.max(8, left), Math.max(8, rect.width - tip.offsetWidth - 8)) + 'px';
            tip.style.top = Math.min(Math.max(8, top), Math.max(8, rect.height - tip.offsetHeight - 8)) + 'px';
        }

        let reportChartHoverIndex = -1;
        let reportChartFsLayout = null;
        let reportChartFsHoverIndex = -1;

        function onReportChartPointer(evt, mode) {
            const isFs = mode === 'fs';
            const layout = isFs ? reportChartFsLayout : reportChartLayout;
            const series = reportChartSeries;
            if (!layout || !series.length) return;
            const svg = document.getElementById(isFs ? 'reportChartFs' : 'reportChart');
            if (!svg || !svg.createSVGPoint) return;
            const clientX = evt.touches && evt.touches[0] ? evt.touches[0].clientX : evt.clientX;
            const clientY = evt.touches && evt.touches[0] ? evt.touches[0].clientY : evt.clientY;
            const pt = svg.createSVGPoint();
            pt.x = clientX;
            pt.y = clientY;
            const ctm = svg.getScreenCTM();
            if (!ctm) return;
            const loc = pt.matrixTransform(ctm.inverse());
            const { pad, plotW, points } = layout;
            const ctx = isFs
                ? { layout, series, prefix: 'fs', tipId: 'reportChartFsTooltip', canvasId: 'reportChartFsCanvas', svgId: 'reportChartFs' }
                : { layout, series, prefix: '', tipId: 'reportChartTooltip', canvasId: 'reportChartCanvas', svgId: 'reportChart' };
            if (loc.x < pad.l || loc.x > pad.l + plotW) {
                if (isFs) reportChartFsHoverIndex = -1;
                else reportChartHoverIndex = -1;
                hideReportChartTooltip(isFs ? 'fs' : '');
                return;
            }
            const ratio = points.length <= 1 ? 0 : (loc.x - pad.l) / plotW;
            const index = Math.round(ratio * (points.length - 1));
            if (isFs) reportChartFsHoverIndex = index;
            else reportChartHoverIndex = index;
            updateReportChartHover(index, ctx);
        }

        function bindReportChartInteractions() {
            const svg = document.getElementById('reportChart');
            if (!svg || svg._reportChartBound) return;
            svg._reportChartBound = true;
            svg.addEventListener('mousemove', (e) => onReportChartPointer(e, 'main'));
            svg.addEventListener('mouseleave', () => {
                reportChartHoverIndex = -1;
                hideReportChartTooltip('');
            });
            svg.addEventListener('touchstart', (e) => onReportChartPointer(e, 'main'), { passive: true });
            svg.addEventListener('touchmove', (e) => onReportChartPointer(e, 'main'), { passive: true });
        }

        function bindReportChartFsInteractions() {
            const svg = document.getElementById('reportChartFs');
            if (!svg || svg._reportChartFsBound) return;
            svg._reportChartFsBound = true;
            svg.addEventListener('mousemove', (e) => onReportChartPointer(e, 'fs'));
            svg.addEventListener('mouseleave', () => {
                reportChartFsHoverIndex = -1;
                hideReportChartTooltip('fs');
            });
            svg.addEventListener('touchstart', (e) => onReportChartPointer(e, 'fs'), { passive: true });
            svg.addEventListener('touchmove', (e) => onReportChartPointer(e, 'fs'), { passive: true });
        }

        function ensureReportChartResizeObserver() {
            const canvas = document.getElementById('reportChartCanvas');
            if (!canvas || typeof ResizeObserver === 'undefined' || canvas._reportChartObserved) return;
            canvas._reportChartObserved = true;
            let timer = null;
            const obs = new ResizeObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const keep = reportChartHoverIndex;
                    if (reportChartSourceSeries && reportChartSourceSeries.length) {
                        renderReportChart(reportChartSourceSeries, { keepHoverIndex: keep });
                    }
                }, 80);
            });
            obs.observe(canvas);
        }

        function paintReportChartSvg(svgId, canvasId, idPrefix, series, size) {
            const built = buildReportChartSvgMarkup(series, {
                withCrosshair: true,
                size,
                canvasId,
                idPrefix
            });
            const svg = document.getElementById(svgId);
            if (!svg) return null;
            const W = (built.model && built.model.W) || size.W;
            const H = (built.model && built.model.H) || size.H;
            svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.innerHTML = built.markup;
            return built.model;
        }

        function renderReportChart(series, options) {
            const opts = options || {};
            reportChartSourceSeries = Array.isArray(series) ? series : [];
            const size = measureReportChartViewSize('reportChartCanvas');
            reportChartLayout = paintReportChartSvg('reportChart', 'reportChartCanvas', '', reportChartSourceSeries, size);
            reportChartSeries = reportChartLayout ? reportChartLayout.points : [];
            renderReportChartTimeAxis(reportChartSeries, 'reportChartTimeAxis');
            bindReportChartInteractions();
            if (opts.keepHoverIndex != null && opts.keepHoverIndex >= 0 && reportChartSeries.length) {
                reportChartHoverIndex = Math.min(opts.keepHoverIndex, reportChartSeries.length - 1);
                updateReportChartHover(reportChartHoverIndex);
            } else {
                reportChartHoverIndex = -1;
                hideReportChartTooltip('');
            }
            ensureReportChartResizeObserver();
            const fsModal = document.getElementById('reportChartFsModal');
            if (fsModal && !fsModal.hidden) renderReportChartFullscreenContent();
        }

        function renderReportChartFullscreenContent() {
            const size = measureReportChartViewSize('reportChartFsCanvas');
            reportChartFsLayout = paintReportChartSvg('reportChartFs', 'reportChartFsCanvas', 'fs', reportChartSourceSeries, size);
            renderReportChartTimeAxis(reportChartFsLayout ? reportChartFsLayout.points : [], 'reportChartFsTimeAxis');
            bindReportChartFsInteractions();
            if (reportChartFsHoverIndex >= 0 && reportChartSeries.length) {
                updateReportChartHover(reportChartFsHoverIndex, {
                    layout: reportChartFsLayout,
                    series: reportChartSeries,
                    prefix: 'fs',
                    tipId: 'reportChartFsTooltip',
                    canvasId: 'reportChartFsCanvas',
                    svgId: 'reportChartFs'
                });
            } else {
                hideReportChartTooltip('fs');
            }
        }

        function onReportChartFsKeydown(evt) {
            if (evt.key === 'Escape') closeReportChartFullscreen();
        }

        function openReportChartFullscreen() {
            if (!reportChartSourceSeries || !reportChartSourceSeries.length) {
                alert('暂无趋势数据');
                return;
            }
            const modal = document.getElementById('reportChartFsModal');
            modal.hidden = false;
            document.addEventListener('keydown', onReportChartFsKeydown);
            requestAnimationFrame(() => {
                renderReportChartFullscreenContent();
            });
        }

        function closeReportChartFullscreen() {
            const modal = document.getElementById('reportChartFsModal');
            if (modal) modal.hidden = true;
            document.removeEventListener('keydown', onReportChartFsKeydown);
            hideReportChartTooltip('fs');
            reportChartFsHoverIndex = -1;
        }

        function setReportCardState(id, state) {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.remove('warn', 'ok');
            if (state) el.classList.add(state);
        }

        function renderReportAlerts(alerts) {
            const banner = document.getElementById('reportAlertBanner');
            ['reportCardRps', 'reportCardAvg', 'reportCardFail', 'reportCardTotal', 'reportCardDb'].forEach((id) => setReportCardState(id, ''));
            if (!alerts || !alerts.enabled) {
                banner.hidden = true;
                banner.innerHTML = '';
                return;
            }
            const failed = (alerts.items || []).filter((x) => !x.passed);
            banner.hidden = false;
            banner.className = 'report-alert-banner ' + (alerts.passed ? 'pass' : 'fail');
            if (alerts.passed) {
                banner.innerHTML = '<strong>阈值告警：通过</strong> · 全部指标均在阈值内';
            } else {
                banner.innerHTML = '<strong>阈值告警：未通过</strong>（' + failed.length + ' 项）' +
                    '<ul class="report-alert-list">' +
                failed.map((x) => '<li>' + (x.apiName ? escapeHtml(x.apiName) + ' - ' : '') + escapeHtml(x.label) + '：实际 ' + x.actual + x.unit +
                        '，阈值 ' + (x.op === 'gte' ? '≥' : '≤') + ' ' + x.threshold + x.unit + '</li>').join('') +
                    '</ul>';
            }
            (alerts.items || []).forEach((item) => {
                if (item.key === 'failRate') setReportCardState('reportCardFail', item.passed ? 'ok' : 'warn');
                if (item.key === 'avgLatencyMs') setReportCardState('reportCardAvg', item.passed ? 'ok' : 'warn');
                if (item.key === 'rps') setReportCardState('reportCardRps', item.passed ? 'ok' : 'warn');
                if (item.key === 'avgDbLatencyMs') setReportCardState('reportCardDb', item.passed ? 'ok' : 'warn');
            });
        }

        function renderReportDetail(report) {
            currentStressReport = report || null;
            const summary = (report && report.summary) || {};
            document.getElementById('reportTotal').textContent = String(summary.total || 0);
            document.getElementById('reportRps').textContent = String(summary.rps || 0);
            document.getElementById('reportAvg').innerHTML = String(summary.avgLatencyMs || 0) + '<span class="unit">ms</span>';
            const dbLabel = document.querySelector('#reportCardDb .label');
            if (dbLabel) {
                dbLabel.textContent = summary.dbTotal
                    ? ('平均 DB 耗时（' + summary.dbTotal + ' 次）')
                    : '平均 DB 耗时';
            }
            document.getElementById('reportDbAvg').innerHTML = String(summary.avgDbLatencyMs || 0) + '<span class="unit">ms</span>';
            document.getElementById('reportFail').innerHTML = Number(summary.failRate || 0).toFixed(2) + '<span class="unit">%</span>';
            renderReportAlerts(report && report.alerts);
            renderReportChart(report && report.series);
            stressExecutionFilter = 'all';
            stressExecutionPage = 1;
            ['reportExecutionNameFilter', 'reportExecutionTimeStart', 'reportExecutionTimeEnd'].forEach((id) => {
                const input = document.getElementById(id);
                if (input) input.value = '';
            });
            renderStressExecutionList();
            const tbody = document.getElementById('reportApiBody');
            const apis = (report && report.apis) || [];
            if (!apis.length) {
                tbody.innerHTML = '<tr><td colspan="8" class="empty-state">暂无接口明细</td></tr>';
                return;
            }
            tbody.innerHTML = apis.map((api, index) => {
                const m = sanitizeHttpMethod(api.method);
                const title = (api.name || '') + ' ' + (api.path || api.url || '');
                return [
                    '<tr>',
                    `<td><span class="report-api-method ${m.css}">${escapeHtml(m.method)}</span><button type="button" class="report-api-link" onclick="openStressApiDetail(${index})" title="查看回放请求与失败样本">${escapeHtml(title.trim())}</button></td>`,
                    `<td>${api.total || 0}</td>`,
                    `<td>${api.rps || 0}</td>`,
                    `<td>${api.avgLatencyMs || 0} ms</td>`,
                    `<td>${api.minLatencyMs || 0} ms</td>`,
                    `<td>${api.maxLatencyMs || 0} ms</td>`,
                    `<td>${api.p90LatencyMs || 0} ms</td>`,
                    `<td>${Number(api.failRate || 0).toFixed(2)}%</td>`,
                    '</tr>'
                ].join('');
            }).join('');
        }

        function formatApiDetailJson(value) {
            try { return JSON.stringify(value && typeof value === 'object' ? value : {}, null, 2); } catch (e) { return ''; }
        }

        function openStressApiDetail(index) {
            const api = currentStressReport && currentStressReport.apis && currentStressReport.apis[index];
            if (!api) return;
            const m = sanitizeHttpMethod(api.method);
            const detail = api.detail || {};
            const request = detail.request || {};
            const failures = Array.isArray(detail.failureSamples) ? detail.failureSamples : [];
            const title = ((api.name || '') + ' ' + (api.path || api.url || '')).trim() || '请求详情';
            document.getElementById('stressApiDetailTitle').innerHTML = '<span class="report-api-method ' + m.css + '">' + escapeHtml(m.method) + '</span> ' + escapeHtml(title);
            const failuresHtml = failures.length ? failures.map((sample, n) => '<div class="api-detail-failure"><strong>失败样本 ' + (n + 1) + '</strong> · HTTP ' + (sample.status || 0) + ' · ' + (sample.latencyMs || 0) + ' ms' + (sample.error ? '<div class="hint">' + escapeHtml(sample.error) + '</div>' : '') + '<h4>响应头</h4><pre class="api-detail-code">' + escapeHtml(formatApiDetailJson(sample.responseHeaders)) + '</pre><h4>响应体</h4><pre class="api-detail-code">' + escapeHtml(sample.responseBody || '（无响应体）') + '</pre></div>').join('') : '<span class="hint">本次压测没有保留失败样本。</span>';
            document.getElementById('stressApiDetailBody').innerHTML = '<div class="api-detail-section"><h4>压测统计</h4><div class="api-detail-meta"><span>总请求<strong>' + (api.total || 0) + '</strong></span><span>平均响应<strong>' + (api.avgLatencyMs || 0) + ' ms</strong></span><span>失败率<strong>' + Number(api.failRate || 0).toFixed(2) + '%</strong></span></div></div><div class="api-detail-section"><h4>实际回放请求</h4><div class="api-detail-url">' + escapeHtml(request.url || api.url || '') + '</div><h4>请求头</h4><pre class="api-detail-code">' + escapeHtml(formatApiDetailJson(request.headers)) + '</pre><h4>请求体</h4><pre class="api-detail-code">' + escapeHtml(request.body || '（空）') + '</pre></div><div class="api-detail-section"><h4>失败响应样本（最多保留 5 条）</h4>' + failuresHtml + '</div>';
            document.getElementById('stressApiDetailModal').hidden = false;
        }

        function closeStressApiDetail() {
            document.getElementById('stressApiDetailModal').hidden = true;
        }

        function setStressExecutionFilter(filter) {
            stressExecutionFilter = ['all', 'pass', 'fail'].indexOf(filter) >= 0 ? filter : 'all';
            stressExecutionPage = 1;
            renderStressExecutionList();
        }

        function resetStressExecutionPage() {
            stressExecutionPage = 1;
            renderStressExecutionList();
        }

        function setStressExecutionPage(page) {
            const target = Number(page);
            stressExecutionPage = Number.isFinite(target)
                ? Math.min(stressExecutionPageTotal, Math.max(1, Math.floor(target)))
                : 1;
            renderStressExecutionList();
        }

        function setStressExecutionPageSize(size) {
            const target = Number(size);
            stressExecutionPageSize = [20, 50, 100, 200].indexOf(target) >= 0 ? target : 50;
            stressExecutionPage = 1;
            renderStressExecutionList();
        }

        function clearStressExecutionSearch() {
            ['reportExecutionNameFilter', 'reportExecutionTimeStart', 'reportExecutionTimeEnd'].forEach((id) => {
                const input = document.getElementById(id);
                if (input) input.value = '';
            });
            stressExecutionPage = 1;
            renderStressExecutionList();
        }

        function renderStressExecutionPagination(total) {
            stressExecutionPageTotal = Math.max(1, Math.ceil(total / stressExecutionPageSize));
            stressExecutionPage = Math.min(stressExecutionPageTotal, Math.max(1, stressExecutionPage));
            const pageSize = document.getElementById('reportExecutionPageSize');
            const pageInfo = document.getElementById('reportExecutionPageInfo');
            if (pageSize) pageSize.value = String(stressExecutionPageSize);
            if (pageInfo) pageInfo.textContent = `第 ${stressExecutionPage} / ${stressExecutionPageTotal} 页 · 共 ${total} 条`;
            ['First', 'Prev'].forEach((name) => {
                const button = document.getElementById('reportExecution' + name + 'Page');
                if (button) button.disabled = stressExecutionPage <= 1;
            });
            ['Next', 'Last'].forEach((name) => {
                const button = document.getElementById('reportExecution' + name + 'Page');
                if (button) button.disabled = stressExecutionPage >= stressExecutionPageTotal;
            });
        }

        function formatStressExecutionTime(timestamp, full) {
            const date = new Date(Number(timestamp));
            if (!Number.isFinite(date.getTime())) return '-';
            const pad = (value, size) => String(value).padStart(size || 2, '0');
            const time = pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) + '.' + pad(date.getMilliseconds(), 3);
            if (!full) return time;
            return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + time;
        }

        function renderStressExecutionList() {
            const body = document.getElementById('reportExecutionBody');
            const note = document.getElementById('reportExecutionNote');
            if (!body || !note) return;
            const report = currentStressReport || {};
            const executions = Array.isArray(report.executions) ? report.executions : [];
            const nameInput = document.getElementById('reportExecutionNameFilter');
            const startInput = document.getElementById('reportExecutionTimeStart');
            const endInput = document.getElementById('reportExecutionTimeEnd');
            const nameQuery = String(nameInput && nameInput.value || '').trim().toLowerCase();
            const startAt = startInput && startInput.value ? new Date(startInput.value).getTime() : NaN;
            const endAt = endInput && endInput.value ? new Date(endInput.value).getTime() : NaN;
            const filtered = executions
                .map((sample, index) => ({ sample, index }))
                .filter((entry) => {
                    if (stressExecutionFilter === 'pass') return entry.sample.ok;
                    if (stressExecutionFilter === 'fail') return !entry.sample.ok;
                    return true;
                })
                .filter((entry) => {
                    const sample = entry.sample;
                    const searchable = [sample.name, sample.path, sample.url].filter(Boolean).join(' ').toLowerCase();
                    if (nameQuery && searchable.indexOf(nameQuery) < 0) return false;
                    const requestAt = Number(sample.at);
                    if (Number.isFinite(startAt) && (!Number.isFinite(requestAt) || requestAt < startAt)) return false;
                    if (Number.isFinite(endAt) && (!Number.isFinite(requestAt) || requestAt > endAt)) return false;
                    return true;
                })
                .sort((a, b) => {
                    const timeDelta = (Number(b.sample.at) || 0) - (Number(a.sample.at) || 0);
                    return timeDelta || b.index - a.index;
                });
            renderStressExecutionPagination(filtered.length);
            const pageStart = (stressExecutionPage - 1) * stressExecutionPageSize;
            const pageItems = filtered.slice(pageStart, pageStart + stressExecutionPageSize);
            document.querySelectorAll('[data-report-execution-filter]').forEach((button) => {
                button.classList.toggle('active', button.getAttribute('data-report-execution-filter') === stressExecutionFilter);
            });
            const retainedText = report.executionDropped
                ? `已保留 ${executions.length} 条，另有 ${report.executionDropped} 条未保留`
                : `已保留 ${executions.length} 条`;
            note.textContent = filtered.length === executions.length
                ? retainedText
                : `匹配 ${filtered.length} 条 · ${retainedText}`;
            if (!executions.length) {
                body.innerHTML = '<div class="empty-state">该历史报告未保存单次请求记录；请重新执行压测后查看实际请求详情。</div>';
                return;
            }
            if (!filtered.length) {
                body.innerHTML = '<div class="empty-state">没有符合当前筛选条件的执行记录。</div>';
                return;
            }
            body.innerHTML = pageItems.map((entry) => {
                const sample = entry.sample;
                const method = sanitizeHttpMethod(sample.method);
                const title = ((sample.name || '') + ' ' + (sample.path || sample.url || '')).trim() || '未命名请求';
                const stateClass = sample.ok ? '' : ' fail';
                const stateText = sample.ok ? '通过' : '失败';
                const statusText = sample.status ? 'HTTP ' + sample.status : (sample.error || '请求失败');
                const requestTime = formatStressExecutionTime(sample.at, false);
                const requestDateTime = formatStressExecutionTime(sample.at, true);
                return '<div class="report-execution-row">' +
                    '<span class="report-execution-state' + stateClass + '">' + stateText + '</span>' +
                    '<button type="button" class="report-execution-link" onclick="openStressExecutionDetail(' + entry.index + ')" title="查看实际请求详情"><span class="report-api-method ' + method.css + '">' + escapeHtml(method.method) + '</span>' + escapeHtml(title) + '</button>' +
                    '<span class="report-execution-time" title="请求发起时间：' + escapeHtml(requestDateTime) + '">' + escapeHtml(requestTime) + '</span>' +
                    '<span class="report-execution-status' + stateClass + '">' + escapeHtml(statusText) + '</span>' +
                    '<span class="report-execution-latency">' + (sample.latencyMs || 0) + ' ms</span>' +
                    '</div>';
            }).join('');
        }

        function openStressExecutionDetail(index) {
            const samples = currentStressReport && currentStressReport.executions;
            const sample = Array.isArray(samples) ? samples[index] : null;
            if (!sample) return;
            const method = sanitizeHttpMethod(sample.method);
            const title = ((sample.name || '') + ' ' + (sample.path || sample.url || '')).trim() || '实际请求详情';
            const requestBody = sample.requestBody || '（空）';
            const responseBody = sample.responseBody || '（未保存响应体）';
            const truncateHint = (sample.requestBodyTruncated || sample.responseBodyTruncated)
                ? '<p class="hint">报文内容已截断，单段最多保留 8KB。</p>' : '';
            document.getElementById('stressApiDetailTitle').innerHTML = '<span class="report-api-method ' + method.css + '">' + escapeHtml(method.method) + '</span> ' + escapeHtml(title);
            document.getElementById('stressApiDetailBody').innerHTML =
                '<div class="api-detail-section"><h4>本次执行结果</h4><div class="api-detail-meta"><span>状态<strong>' + escapeHtml(sample.status ? 'HTTP ' + sample.status : (sample.ok ? '成功' : '失败')) + '</strong></span><span>耗时<strong>' + (sample.latencyMs || 0) + ' ms</strong></span><span>结果<strong>' + (sample.ok ? '通过' : '失败') + '</strong></span><span>请求时间<strong>' + escapeHtml(formatStressExecutionTime(sample.at, false)) + '</strong></span></div>' + (sample.error ? '<p class="hint">' + escapeHtml(sample.error) + '</p>' : '') + '</div>' +
                '<div class="api-detail-section"><h4>实际请求</h4><div class="api-detail-url">' + escapeHtml(sample.url || '') + '</div><h4>请求头</h4><pre class="api-detail-code">' + escapeHtml(formatApiDetailJson(sample.requestHeaders)) + '</pre><h4>请求体</h4><pre class="api-detail-code">' + escapeHtml(requestBody) + '</pre></div>' +
                '<div class="api-detail-section"><h4>实际响应</h4><h4>响应头</h4><pre class="api-detail-code">' + escapeHtml(formatApiDetailJson(sample.responseHeaders)) + '</pre><h4>响应体</h4><pre class="api-detail-code">' + escapeHtml(responseBody) + '</pre>' + truncateHint + '</div>';
            document.getElementById('stressApiDetailModal').hidden = false;
        }

        function reportExportFileBase(report) {
            const ts = report && (report.startedAt || report.endedAt) ? Number(report.startedAt || report.endedAt) : Date.now();
            const d = new Date(Number.isFinite(ts) ? ts : Date.now());
            const pad = (n) => String(n).padStart(2, '0');
            return 'stress-report-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
                '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
        }

        function buildStressReportExportHtml(report, options) {
            const opts = options || {};
            const summary = (report && report.summary) || {};
            const config = (report && report.config) || {};
            const apis = (report && report.apis) || [];
            const rows = apis.length
                ? apis.map((api) => {
                    const m = sanitizeHttpMethod(api.method);
                    const title = ((api.name || '') + ' ' + (api.path || api.url || '')).trim();
                    return '<tr>' +
                        '<td><span class="m ' + m.css + '">' + escapeHtml(m.method) + '</span>' + escapeHtml(title) + '</td>' +
                        '<td>' + (api.total || 0) + '</td>' +
                        '<td>' + (api.rps || 0) + '</td>' +
                        '<td>' + (api.avgLatencyMs || 0) + ' ms</td>' +
                        '<td>' + (api.minLatencyMs || 0) + ' ms</td>' +
                        '<td>' + (api.maxLatencyMs || 0) + ' ms</td>' +
                        '<td>' + (api.p90LatencyMs || 0) + ' ms</td>' +
                        '<td>' + Number(api.failRate || 0).toFixed(2) + '%</td>' +
                        '</tr>';
                }).join('')
                : '<tr><td colspan="8">暂无接口明细</td></tr>';
            const meta = [
                '状态 ' + escapeHtml((report && report.status) || '-'),
                '并发 ' + (config.users || 0),
                '时长 ' + (config.durationMin || 0) + ' 分钟',
                '爬坡 ' + (config.rampUpMin || 0) + ' 分钟',
                '开始 ' + escapeHtml(formatReportTime(report && report.startedAt))
            ].join(' · ');
            const autoPrint = opts.autoPrint
                ? '<scr' + 'ipt>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},300);});</scr' + 'ipt>'
                : '';
            return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
                '<title>' + escapeHtml(reportExportFileBase(report)) + '</title>' +
                '<style>' +
                'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;margin:24px;color:#263238;background:#fff;}' +
                'h1{font-size:22px;margin:0 0 8px;} .meta{color:#78909c;font-size:13px;margin-bottom:18px;}' +
                '.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px;}' +
                '.card{border:1px solid #eceff1;border-radius:10px;padding:14px 16px;}' +
                '.card .l{color:#78909c;font-size:12px;margin-bottom:8px;} .card .v{font-size:28px;font-weight:700;}' +
                '.card .u{font-size:13px;color:#90a4ae;margin-left:4px;}' +
                '.box{border:1px solid #eceff1;border-radius:10px;padding:12px;margin-bottom:18px;}' +
                '.box h2{font-size:14px;margin:0 0 10px;}' +
                'svg{width:100%;height:300px;display:block;background:#fff;}' +
                'table{width:100%;border-collapse:collapse;font-size:12px;}' +
                'th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;}' +
                'th{background:#fafafa;}' +
                '.m{display:inline-block;min-width:42px;text-align:center;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:700;margin-right:6px;}' +
                '.GET{background:#e3f2fd;color:#1565c0;} .POST{background:#e8f5e9;color:#2e7d32;}' +
                '.PUT{background:#fff3e0;color:#ef6c00;} .DELETE{background:#ffebee;color:#c62828;}' +
                '.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#607d8b;margin-bottom:8px;}' +
                '@media print{body{margin:12px;} .cards{break-inside:avoid;} .box{break-inside:avoid;}}' +
                '</style></head><body>' +
                '<h1>测试报告</h1><div class="meta">' + meta + '</div>' +
                '<div class="cards">' +
                '<div class="card"><div class="l">总请求次数</div><div class="v">' + (summary.total || 0) + '</div></div>' +
                '<div class="card"><div class="l">每秒接口请求数</div><div class="v">' + (summary.rps || 0) + '</div></div>' +
                '<div class="card"><div class="l">平均响应时间</div><div class="v">' + (summary.avgLatencyMs || 0) + '<span class="u">ms</span></div></div>' +
                '<div class="card"><div class="l">平均 DB 耗时</div><div class="v">' + (summary.avgDbLatencyMs || 0) + '<span class="u">ms</span></div></div>' +
                '<div class="card"><div class="l">请求失败率</div><div class="v">' + Number(summary.failRate || 0).toFixed(2) + '<span class="u">%</span></div></div>' +
                '</div>' +
                '<div class="box"><h2>性能趋势</h2>' +
                '<div class="legend"><span>每秒接口请求数</span><span>平均响应时间</span><span>请求失败率</span><span>并发用户数</span></div>' +
                '<svg viewBox="0 0 1100 300" width="100%" height="300" preserveAspectRatio="none">' +
                buildReportChartSvgMarkup(report && report.series, { size: { W: 1100, H: 300 } }).markup +
                '</svg>' +
                '<div style="display:flex;justify-content:space-between;margin:4px 132px 0 58px;font-size:11px;color:#78909c;">' +
                (function () {
                    const pts = (report && report.series) || [];
                    return pickChartTimeLabelIndexes(pts.length, Math.min(8, pts.length)).map((idx) =>
                        '<span>' + escapeHtml(formatChartClock(pts[idx].ts)) + '</span>'
                    ).join('');
                })() +
                '</div></div>' +
                '<div class="box"><h2>接口明细</h2><table><thead><tr>' +
                '<th>接口请求</th><th>总请求次数</th><th>每秒接口请求数</th><th>平均响应时间</th>' +
                '<th>最小响应时间</th><th>最大响应时间</th><th>90% 响应时间</th><th>失败率</th>' +
                '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
                autoPrint +
                '</body></html>';
        }

        function toggleReportDownloadMenu(event) {
            if (event) event.stopPropagation();
            const menu = document.getElementById('reportDownloadMenu');
            menu.hidden = !menu.hidden;
        }

        function hideReportDownloadMenu() {
            const menu = document.getElementById('reportDownloadMenu');
            if (menu) menu.hidden = true;
        }

        function downloadStressReportFile(format) {
            hideReportDownloadMenu();
            const status = document.getElementById('stressReportStatus');
            if (!currentStressReport) {
                status.textContent = '暂无报告可下载';
                return;
            }
            const base = reportExportFileBase(currentStressReport);
            if (format === 'html') {
                const html = buildStressReportExportHtml(currentStressReport, { autoPrint: false });
                const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = base + '.html';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                status.textContent = '已下载 HTML：' + base + '.html';
                return;
            }
            if (format === 'pdf') {
                const id = currentStressReport.id;
                if (!id) {
                    status.textContent = '报告缺少 id，无法下载 PDF';
                    return;
                }
                status.textContent = '正在生成 PDF…';
                fetch('./api/stress/reports/' + encodeURIComponent(id) + '/pdf')
                    .then(async (res) => {
                        if (!res.ok) {
                            let msg = '生成 PDF 失败';
                            try {
                                const j = await res.json();
                                msg = j.msg || msg;
                            } catch (e) {}
                            throw new Error(msg);
                        }
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = base + '.pdf';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        status.textContent = '已下载 PDF：' + base + '.pdf';
                    })
                    .catch((e) => {
                        status.textContent = e.message || '下载 PDF 失败';
                    });
                return;
            }
            status.textContent = '不支持的下载格式';
        }

        document.addEventListener('click', (e) => {
            const wrap = document.querySelector('.report-dl-wrap');
            if (wrap && wrap.contains(e.target)) return;
            hideReportDownloadMenu();
        });

        async function loadStressReportDetail(id) {
            const status = document.getElementById('stressReportStatus');
            currentStressReportId = id || '';
            if (!id) {
                renderReportDetail(null);
                status.textContent = '暂无报告';
                return;
            }
            status.textContent = '加载中…';
            try {
                const res = await fetch('./api/stress/reports/' + encodeURIComponent(id));
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '读取报告失败');
                renderReportDetail(result.data);
                updateStressBaselineButton();
                const cfg = (result.data && result.data.config) || {};
                status.textContent = [
                    '状态 ' + ((result.data && result.data.status) || '-'),
                    '并发 ' + (cfg.users || 0),
                    '时长 ' + (cfg.durationMin || 0) + ' 分钟',
                    '爬坡 ' + (cfg.rampUpMin || 0) + ' 分钟'
                ].join(' · ');
            } catch (e) {
                currentStressReport = null;
                renderReportDetail(null);
                status.textContent = e.message || '读取报告失败';
            }
        }

        async function openStressReportModal(preferredId) {
            document.getElementById('stressReportModal').hidden = false;
            document.body.style.overflow = 'hidden';
            hideReportDownloadMenu();
            const status = document.getElementById('stressReportStatus');
            const select = document.getElementById('stressReportSelect');
            status.textContent = '加载报告列表…';
            try {
                let prefer = preferredId || '';
                if (!prefer) {
                    const stRes = await fetch('./api/stress/status');
                    const st = await stRes.json();
                    if (stRes.ok && st.code === 0 && st.data && st.data.lastReportId) {
                        prefer = st.data.lastReportId;
                    }
                }
                const res = await fetch('./api/stress/reports');
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '读取报告失败');
                const items = (result.data && result.data.items) || [];
                stressReportItems = items;
                applyStressBaselineFromApi(result.data);
                if (!items.length) {
                    select.innerHTML = '<option value="">暂无历史报告</option>';
                    currentStressReportId = '';
                    renderReportDetail(null);
                    status.textContent = '暂无报告，请先运行一次压力测试';
                    return;
                }
                select.innerHTML = items.map((item) => (
                    `<option value="${escapeHtml(item.id)}">${escapeHtml(formatReportOption(item))}</option>`
                )).join('');
                const pick = items.some((x) => x.id === prefer) ? prefer : items[0].id;
                select.value = pick;
                await loadStressReportDetail(pick);
                const mysqlSync = result.data && result.data.mysqlSync;
                if (mysqlSync && mysqlSync.ok === false && mysqlSync.error) {
                    status.textContent = (status.textContent ? status.textContent + ' · ' : '') +
                        'MySQL 同步失败：' + mysqlSync.error;
                }
            } catch (e) {
                status.textContent = e.message || '读取报告失败';
            }
        }

        function closeStressReportModal() {
            hideReportDownloadMenu();
            closeReportChartFullscreen();
            document.getElementById('stressReportModal').hidden = true;
            document.body.style.overflow = '';
        }

        function formatNotifyChannelSummary(notify) {
            const n = notify || {};
            const parts = [];
            if (n.webhookEnabled && n.webhookUrl) parts.push('Webhook 已配置');
            else if (n.webhookEnabled) parts.push('Webhook 已启用但未填 URL');
            else parts.push('Webhook 未启用');
            if (n.emailEnabled && (n.emailHookUrl || n.notifyEmail || n.email)) {
                parts.push('邮件 Webhook 已配置');
            } else if (n.emailEnabled) {
                parts.push('邮件已启用但未配置');
            } else {
                parts.push('邮件未启用');
            }
            return parts.join(' · ');
        }

        async function fetchGeneralNotifyConfig() {
            try {
                const res = await fetch(pluginApiUrl('api/general/notify'));
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '读取通知设置失败');
                return result.data || {};
            } catch (e) {
                if (typeof loadGeneralSettingsState === 'function') {
                    const local = loadGeneralSettingsState();
                    return (local && local.notify) || {};
                }
                return {};
            }
        }

        async function renderThresholdNotifySummary() {
            const el = document.getElementById('thNotifySummary');
            if (!el) return;
            try {
                const notify = await fetchGeneralNotifyConfig();
                el.textContent = '通知渠道：' + formatNotifyChannelSummary(notify);
            } catch (e) {
                el.textContent = '通知渠道：读取失败';
            }
        }

        function openThresholdNotifySettings() {
            closeStressThresholdModal();
            if (typeof openGeneralSettingsModal === 'function') {
                openGeneralSettingsModal();
                selectGeneralSettingsTab('notify');
            }
        }

        async function openStressThresholdModal() {
            document.getElementById('stressThresholdModal').hidden = false;
            document.getElementById('thresholdStatus').textContent = '';
            try {
                const [thRes, notify] = await Promise.all([
                    fetch('./api/stress/thresholds').then((r) => r.json()),
                    fetchGeneralNotifyConfig()
                ]);
                if (!thRes || thRes.code !== 0) throw new Error((thRes && thRes.msg) || '读取阈值失败');
                const d = thRes.data || {};
                document.getElementById('thEnabled').checked = d.enabled !== false;
                document.getElementById('thMaxFailRate').value = d.maxFailRate;
                document.getElementById('thMaxAvg').value = d.maxAvgLatencyMs;
                document.getElementById('thMaxP90').value = d.maxP90LatencyMs;
                document.getElementById('thMaxP95').value = d.maxP95LatencyMs;
                document.getElementById('thMinRps').value = d.minRps;
                document.getElementById('thMaxAvgDb').value = d.maxAvgDbLatencyMs != null ? d.maxAvgDbLatencyMs : 0;
                document.getElementById('thWebhookOnFail').checked = d.webhookOnFail !== false;
                document.getElementById('thWebhookOnPass').checked = d.webhookOnPass === true;
                const summary = document.getElementById('thNotifySummary');
                if (summary) summary.textContent = '通知渠道：' + formatNotifyChannelSummary(notify);
            } catch (e) {
                document.getElementById('thresholdStatus').textContent = e.message || '读取失败';
            }
        }

        function closeStressThresholdModal() {
            document.getElementById('stressThresholdModal').hidden = true;
        }

        function collectStressThresholdPayload() {
            return {
                enabled: document.getElementById('thEnabled').checked,
                maxFailRate: document.getElementById('thMaxFailRate').value,
                maxAvgLatencyMs: document.getElementById('thMaxAvg').value,
                maxP90LatencyMs: document.getElementById('thMaxP90').value,
                maxP95LatencyMs: document.getElementById('thMaxP95').value,
                minRps: document.getElementById('thMinRps').value,
                maxAvgDbLatencyMs: document.getElementById('thMaxAvgDb').value,
                webhookOnFail: document.getElementById('thWebhookOnFail').checked,
                webhookOnPass: document.getElementById('thWebhookOnPass').checked
            };
        }

        async function saveStressThresholds() {
            const status = document.getElementById('thresholdStatus');
            status.textContent = '保存中…';
            try {
                const payload = collectStressThresholdPayload();
                const res = await fetch('./api/stress/thresholds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                status.textContent = result.msg || '已保存';
                if (currentStressReportId) await loadStressReportDetail(currentStressReportId);
                setTimeout(closeStressThresholdModal, 400);
            } catch (e) {
                status.textContent = e.message || '保存失败';
            }
        }

        function fillCompareSelects(items, preferCurrent) {
            const opts = (items || []).map((item) =>
                `<option value="${escapeHtml(item.id)}">${escapeHtml(formatReportOption(item))}</option>`
            ).join('');
            const baseline = document.getElementById('compareBaselineSelect');
            const current = document.getElementById('compareCurrentSelect');
            baseline.innerHTML = opts || '<option value="">暂无报告</option>';
            current.innerHTML = opts || '<option value="">暂无报告</option>';
            const hasBaseline = stressBaselineId && items && items.some((x) => x.id === stressBaselineId);
            if (items && items.length >= 2) {
                baseline.value = hasBaseline ? stressBaselineId : items[1].id;
                let currentPick = preferCurrent && items.some((x) => x.id === preferCurrent)
                    ? preferCurrent
                    : items[0].id;
                if (currentPick === baseline.value) {
                    const alt = items.find((x) => x.id !== baseline.value);
                    currentPick = alt ? alt.id : currentPick;
                }
                current.value = currentPick;
            } else if (items && items.length === 1) {
                baseline.value = items[0].id;
                current.value = items[0].id;
            }
        }

        async function openStressCompareModal() {
            document.getElementById('stressCompareModal').hidden = false;
            document.getElementById('compareStatus').textContent = '加载报告列表…';
            document.getElementById('compareSummary').innerHTML = '';
            document.getElementById('compareCounts').textContent = '';
            document.getElementById('compareApiBody').innerHTML =
                '<tr><td colspan="7" class="empty-state">选择两份报告后点击「开始对比」</td></tr>';
            const overlayWrap = document.getElementById('compareOverlayWrap');
            if (overlayWrap) overlayWrap.hidden = true;
            const overlaySvg = document.getElementById('compareOverlayChart');
            if (overlaySvg) overlaySvg.innerHTML = '';
            lastStressCompareResult = null;
            try {
                const res = await fetch('./api/stress/reports');
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '读取报告失败');
                const items = (result.data && result.data.items) || [];
                stressReportItems = items;
                applyStressBaselineFromApi(result.data);
                fillCompareSelects(items, currentStressReportId);
                document.getElementById('compareStatus').textContent = items.length
                    ? ('共 ' + items.length + ' 份报告' + (stressBaselineId ? ' · 已固定基线' : ''))
                    : '暂无历史报告';
            } catch (e) {
                document.getElementById('compareStatus').textContent = e.message || '读取失败';
            }
        }

        function closeStressCompareModal() {
            document.getElementById('stressCompareModal').hidden = true;
        }

        function formatCompareDelta(metric, betterWhenLower) {
            const d = metric || {};
            const sign = d.delta > 0 ? '+' : '';
            const cls = d.delta === 0 ? 'flat' : ((betterWhenLower ? d.delta > 0 : d.delta < 0) ? 'up' : 'down');
            return {
                text: sign + d.delta + ' (' + sign + d.deltaPct + '%)',
                cls,
                line: (d.baseline == null ? '-' : d.baseline) + ' → ' + (d.current == null ? '-' : d.current)
            };
        }

        function renderCompareOverlayChart(seriesPair) {
            const wrap = document.getElementById('compareOverlayWrap');
            const svg = document.getElementById('compareOverlayChart');
            if (!wrap || !svg) return;
            const baseline = (seriesPair && seriesPair.baseline) || [];
            const current = (seriesPair && seriesPair.current) || [];
            if (!baseline.length && !current.length) {
                wrap.hidden = true;
                svg.innerHTML = '';
                return;
            }
            wrap.hidden = false;
            const W = 900;
            const H = 220;
            const pad = { l: 48, r: 56, t: 14, b: 18 };
            const plotW = W - pad.l - pad.r;
            const plotH = H - pad.t - pad.b;
            const norm = (arr) => {
                if (!arr.length) return [];
                if (arr.length === 1) return [{ x: 0.5, rps: Number(arr[0].rps) || 0, rt: Number(arr[0].avgLatencyMs) || 0 }];
                return arr.map((p, i) => ({
                    x: i / (arr.length - 1),
                    rps: Number(p.rps) || 0,
                    rt: Number(p.avgLatencyMs) || 0
                }));
            };
            const b = norm(baseline);
            const c = norm(current);
            const allRt = b.concat(c).map((p) => p.rt);
            const allRps = b.concat(c).map((p) => p.rps);
            const maxRt = niceAxisMax(Math.max(0, ...allRt), 1);
            const maxRps = niceAxisMax(Math.max(0, ...allRps), 1);
            const xAt = (ratio) => pad.l + ratio * plotW;
            const yRt = (v) => pad.t + plotH - (Math.min(maxRt, Math.max(0, v)) / maxRt) * plotH;
            const yRps = (v) => pad.t + plotH - (Math.min(maxRps, Math.max(0, v)) / maxRps) * plotH;
            const pathOf = (pts, yFn, key) => {
                if (!pts.length) return '';
                return pts.map((p, i) => {
                    const x = xAt(p.x).toFixed(1);
                    const y = yFn(p[key]).toFixed(1);
                    return (i === 0 ? 'M' : 'L') + x + ' ' + y;
                }).join(' ');
            };
            const axisBaseY = pad.t + plotH;
            const ticks = 5;
            const grid = [];
            const leftLabels = [];
            const rightLabels = [];
            for (let i = 0; i <= ticks; i += 1) {
                const ratio = i / ticks;
                const y = axisBaseY - ratio * plotH;
                grid.push('<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (pad.l + plotW).toFixed(1) +
                    '" y2="' + y.toFixed(1) + '" stroke="#f0f2f5" />');
                leftLabels.push('<text x="' + (pad.l - 6).toFixed(1) + '" y="' + (y + 3).toFixed(1) +
                    '" text-anchor="end" fill="#90caf9" font-size="10">' + formatAxisNumber(ratio * maxRt) + 'ms</text>');
                rightLabels.push('<text x="' + (pad.l + plotW + 6).toFixed(1) + '" y="' + (y + 3).toFixed(1) +
                    '" text-anchor="start" fill="#ef6c00" font-size="10">' + formatAxisNumber(ratio * maxRps) + '</text>');
            }
            svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
            svg.innerHTML = [
                '<rect x="' + pad.l + '" y="' + pad.t + '" width="' + plotW + '" height="' + plotH + '" fill="#fafbfc" />',
                grid.join(''),
                '<path d="' + pathOf(b, yRt, 'rt') + '" fill="none" stroke="#90caf9" stroke-width="2" stroke-dasharray="5 4" />',
                '<path d="' + pathOf(c, yRt, 'rt') + '" fill="none" stroke="#1565c0" stroke-width="2.2" />',
                '<path d="' + pathOf(b, yRps, 'rps') + '" fill="none" stroke="#ffcc80" stroke-width="2" stroke-dasharray="5 4" />',
                '<path d="' + pathOf(c, yRps, 'rps') + '" fill="none" stroke="#ef6c00" stroke-width="2.2" />',
                '<line x1="' + pad.l + '" y1="' + axisBaseY + '" x2="' + (pad.l + plotW) + '" y2="' + axisBaseY + '" stroke="#546e7a" />',
                leftLabels.join(''),
                rightLabels.join('')
            ].join('');
        }

        function renderCompareResult(data) {
            lastStressCompareResult = data || null;
            const summary = data.summary || {};
            const cards = [
                { key: 'rps', label: 'RPS', lowerBad: true },
                { key: 'avgLatencyMs', label: '平均 RT', lowerBad: false },
                { key: 'p90LatencyMs', label: 'P90', lowerBad: false },
                { key: 'failRate', label: '失败率', lowerBad: false },
                { key: 'avgDbLatencyMs', label: '平均 DB', lowerBad: false }
            ];
            document.getElementById('compareSummary').innerHTML = cards.map((c) => {
                const fmt = formatCompareDelta(summary[c.key], !c.lowerBad);
                return '<div class="compare-card"><div class="label">' + c.label + '</div>' +
                    '<div class="vals">' + escapeHtml(fmt.line) + '</div>' +
                    '<div class="delta ' + fmt.cls + '">' + escapeHtml(fmt.text) + '</div></div>';
            }).join('');
            renderCompareOverlayChart(data.series);

            const counts = data.counts || {};
            const both = Number(counts.both) || 0;
            const added = Number(counts.added) || 0;
            const removed = Number(counts.removed) || 0;
            const countsEl = document.getElementById('compareCounts');
            countsEl.innerHTML = '接口匹配：<strong>双侧都有 ' + both + '</strong> · 仅当前有 ' + added +
                ' · 仅基线有 ' + removed +
                ' <span class="hint">（按 Method + Path 对齐；「仅基线有」表示当前报告未包含该接口，不是字段丢失）</span>';

            const apis = data.apis || [];
            const tbody = document.getElementById('compareApiBody');
            if (!apis.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="empty-state">无接口明细差异</td></tr>';
                return;
            }
            const statusMap = {
                both: { text: '双侧都有', title: '两份报告都包含该接口' },
                added: { text: '仅当前有', title: '仅当前报告有，基线报告没有该接口' },
                removed: { text: '仅基线有', title: '仅基线报告有，当前报告没有该接口' }
            };
            tbody.innerHTML = apis.map((api) => {
                const m = sanitizeHttpMethod(api.method);
                const title = (api.name || '') + ' ' + (api.path || '');
                const st = statusMap[api.status] || { text: api.status || '-', title: '' };
                const rt = formatCompareDelta(api.avgLatencyMs, true);
                const p90 = formatCompareDelta(api.p90LatencyMs, true);
                const fail = formatCompareDelta(api.failRate, true);
                const rps = formatCompareDelta(api.rps, false);
                const total = formatCompareDelta(api.total, false);
                return '<tr>' +
                    '<td><span class="report-api-method ' + m.css + '">' + escapeHtml(m.method) + '</span>' + escapeHtml(title.trim()) + '</td>' +
                    '<td><span class="compare-status ' + escapeHtml(api.status || '') + '" title="' + escapeHtml(st.title) + '">' +
                    escapeHtml(st.text) + '</span></td>' +
                    '<td>' + escapeHtml(total.text) + '</td>' +
                    '<td>' + escapeHtml(rps.text) + '</td>' +
                    '<td class="' + rt.cls + '">' + escapeHtml(rt.text) + '</td>' +
                    '<td class="' + p90.cls + '">' + escapeHtml(p90.text) + '</td>' +
                    '<td class="' + fail.cls + '">' + escapeHtml(fail.text) + '</td>' +
                    '</tr>';
            }).join('');
        }

        function downloadStressCompareReport() {
            if (!lastStressCompareResult) {
                document.getElementById('compareStatus').textContent = '请先完成一次对比';
                return;
            }
            const blob = new Blob([JSON.stringify({
                generatedAt: new Date().toISOString(),
                pinnedBaselineId: stressBaselineId || null,
                ...lastStressCompareResult
            }, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'stress_compare_' + Date.now() + '.json';
            a.click();
            window.URL.revokeObjectURL(url);
            document.getElementById('compareStatus').textContent = '已下载对比 JSON';
        }

        async function runStressCompare() {
            const status = document.getElementById('compareStatus');
            const baselineId = document.getElementById('compareBaselineSelect').value;
            const currentId = document.getElementById('compareCurrentSelect').value;
            if (!baselineId || !currentId) {
                status.textContent = '请选择两份报告';
                return;
            }
            if (baselineId === currentId) {
                status.textContent = '请选择不同的两份报告';
                return;
            }
            status.textContent = '对比中…';
            try {
                const res = await fetch('./api/stress/reports/compare', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ baselineId, currentId })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '对比失败');
                renderCompareResult(result.data);
                const a = result.data.current && result.data.current.alerts;
                status.textContent = a && a.enabled
                    ? (a.passed ? '对比完成 · 当前报告阈值通过' : '对比完成 · 当前报告阈值未通过')
                    : '对比完成';
            } catch (e) {
                status.textContent = e.message || '对比失败';
            }
        }

        async function deleteCurrentStressReport() {
            const status = document.getElementById('stressReportStatus');
            if (!currentStressReportId) {
                status.textContent = '没有可删除的报告';
                return;
            }
            if (!confirm('确认删除当前测试报告？')) return;
            try {
                const res = await fetch('./api/stress/reports/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: currentStressReportId })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '删除失败');
                await openStressReportModal();
            } catch (e) {
                status.textContent = e.message || '删除失败';
            }
        }
