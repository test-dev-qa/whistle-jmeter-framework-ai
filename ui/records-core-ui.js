'use strict';
// Records list, detail, virtual scroll — extracted from index.html

        const DETAIL_TABLE_HEIGHT_STORAGE_KEY = 'whistle.jmeter-exporter.detail-table-height';
        const DETAIL_TABLE_MIN_HEIGHT = 120;
        const DETAIL_PANEL_MIN_HEIGHT = 180;

        function setDetailTableHeight(height) {
            const table = document.querySelector('.table-container');
            if (!table) return;
            const next = Math.max(DETAIL_TABLE_MIN_HEIGHT, Math.round(Number(height) || 0));
            table.style.flex = '0 0 ' + next + 'px';
            table.style.maxHeight = next + 'px';
            try { localStorage.setItem(DETAIL_TABLE_HEIGHT_STORAGE_KEY, String(next)); } catch (e) {}
        }

        function initDetailPanelResizer() {
            const resizer = document.getElementById('detailResizer');
            const table = document.querySelector('.table-container');
            const detail = document.getElementById('detailPanel');
            if (!resizer || !table || !detail) return;
            try {
                const saved = Number(localStorage.getItem(DETAIL_TABLE_HEIGHT_STORAGE_KEY));
                if (Number.isFinite(saved) && saved >= DETAIL_TABLE_MIN_HEIGHT) setDetailTableHeight(saved);
            } catch (e) {}

            let drag = null;
            const finish = () => {
                if (!drag) return;
                drag = null;
                resizer.classList.remove('is-dragging');
                document.body.classList.remove('is-detail-resizing');
            };
            const apply = (offsetY) => {
                if (!drag) return;
                const target = Math.min(drag.maxHeight, Math.max(DETAIL_TABLE_MIN_HEIGHT, drag.startHeight + offsetY));
                setDetailTableHeight(target);
            };
            resizer.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return;
                const tableHeight = table.getBoundingClientRect().height;
                const detailHeight = detail.getBoundingClientRect().height;
                drag = {
                    startY: event.clientY,
                    startHeight: tableHeight,
                    maxHeight: tableHeight + Math.max(0, detailHeight - DETAIL_PANEL_MIN_HEIGHT)
                };
                resizer.setPointerCapture(event.pointerId);
                resizer.classList.add('is-dragging');
                document.body.classList.add('is-detail-resizing');
                event.preventDefault();
            });
            resizer.addEventListener('pointermove', (event) => {
                if (drag) apply(event.clientY - drag.startY);
            });
            resizer.addEventListener('pointerup', finish);
            resizer.addEventListener('pointercancel', finish);
            resizer.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                const delta = event.key === 'ArrowUp' ? -24 : 24;
                const tableHeight = table.getBoundingClientRect().height;
                const maxHeight = tableHeight + Math.max(0, detail.getBoundingClientRect().height - DETAIL_PANEL_MIN_HEIGHT);
                setDetailTableHeight(Math.min(maxHeight, Math.max(DETAIL_TABLE_MIN_HEIGHT, tableHeight + delta)));
                event.preventDefault();
            });
        }

        function updateSelectAllState() {
            const el = document.getElementById('selectAll');
            if (!el) return;
            const filtered = filteredCache;
            if (!filtered.length) {
                el.checked = false;
                return;
            }
            el.checked = filtered.every((record) => checkedIdSet.has(String(record.id)));
        }

        function onRecordCheck(event, id) {
            event.stopPropagation();
            const key = String(id);
            if (event.target.checked) checkedIdSet.add(key);
            else checkedIdSet.delete(key);
            onCheckChange();
        }

        function formatSize(bytes) {
            const n = Number(bytes) || 0;
            if (n < 1024) return n + ' B';
            if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
            return (n / 1024 / 1024).toFixed(1) + ' MB';
        }

        function formatNetworkSize(bytes) {
            const n = Number(bytes);
            if (!Number.isFinite(n) || n < 0) return '-';
            if (n < 100) return n + ' B';
            if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' kB';
            return (n / 1024 / 1024).toFixed(1) + ' MB';
        }

        function formatTiming(ms) {
            if (ms == null || ms === '') return '-';
            const n = Number(ms);
            if (!Number.isFinite(n) || n < 0) return '-';
            if (n < 1000) return Math.round(n) + ' ms';
            const sec = n / 1000;
            let text;
            if (sec < 10) text = sec.toFixed(2);
            else if (sec < 100) text = sec.toFixed(1);
            else text = String(Math.round(sec));
            text = text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
            return text + ' s';
        }

        function formatBody(text) {
            if (text == null || text === '') return '';
            const raw = String(text).replace(/^\uFEFF/, '').trim();
            try {
                return JSON.stringify(JSON.parse(raw), null, 2);
            } catch (e) {
                return String(text);
            }
        }

        function tryFormatJson(text) {
            const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
            if (!raw) return { ok: false, text: '' };
            try {
                return { ok: true, text: JSON.stringify(JSON.parse(raw), null, 2) };
            } catch (e) {
                return { ok: false, text: String(text) };
            }
        }

        function copyText(text) {
            const value = String(text == null ? '' : text);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(value).then(() => true).catch(() => copyTextFallback(value));
            }
            return Promise.resolve(copyTextFallback(value));
        }

        function copyTextFallback(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            return ok;
        }

        function markCopied(btn) {
            if (!btn) return;
            const prev = btn.getAttribute('data-label') || btn.textContent;
            btn.setAttribute('data-label', prev);
            btn.textContent = '已复制';
            btn.classList.add('ok');
            clearTimeout(Number(btn.getAttribute('data-timer') || 0));
            const timer = setTimeout(() => {
                btn.textContent = btn.getAttribute('data-label') || '复制';
                btn.classList.remove('ok');
            }, 1500);
            btn.setAttribute('data-timer', String(timer));
        }

        async function copyPayload(key, btn) {
            const text = key === 'reqDump' || key === 'resDump'
                ? buildDump(key)
                : readPayload(key);
            const ok = await copyText(text);
            if (ok) markCopied(btn);
            else alert('复制失败，请手动全选后复制');
        }

        function readPayload(key) {
            const area = document.getElementById('copy-src-' + key);
            return area ? area.value : (copyPayloads[key] || '');
        }

        function buildDump(key) {
            if (key === 'reqDump') {
                return `${copyPayloads.reqMeta || ''}\n\nHeaders:\n${readPayload('reqHeaders')}\n\nBody:\n${readPayload('reqBody')}`;
            }
            return `${copyPayloads.resMeta || ''}\n\nHeaders:\n${readPayload('resHeaders')}\n\nBody:\n${readPayload('resBody')}`;
        }

        function formatPayload(key, btn) {
            const area = document.getElementById('copy-src-' + key);
            if (!area) return;
            const result = tryFormatJson(area.value);
            if (!result.ok) {
                if (btn) {
                    const prev = btn.textContent;
                    btn.textContent = '非 JSON';
                    setTimeout(() => { btn.textContent = prev; }, 1500);
                }
                return;
            }
            area.value = result.text;
            copyPayloads[key] = result.text;
        }

        function renderMsgBlock(title, text, key, canFormat) {
            copyPayloads[key] = text;
            const formatBtn = canFormat
                ? `<button type="button" class="btn-format" onclick="formatPayload('${key}', this)">格式化</button>`
                : '';
            return `
                <div class="msg-block">
                    <div class="msg-block-head">
                        <h3>${escapeHtml(title)}</h3>
                        ${formatBtn}
                        <button type="button" class="btn-copy" onclick="copyPayload('${key}', this)">复制</button>
                    </div>
                    <textarea class="msg-body" id="copy-src-${key}" spellcheck="false">${escapeHtml(text)}</textarea>
                </div>
            `;
        }

        function statusClass(status) {
            const n = Number(status);
            if (n >= 400) return 'status-error';
            if (n >= 300) return 'status-redirect';
            return 'status-ok';
        }

        function matchStatus(status, filter) {
            if (!filter) return true;
            const n = Number(status);
            if (!Number.isFinite(n)) return false;
            const bucket = Math.floor(n / 100) + 'xx';
            return bucket === filter;
        }

        function fingerprint(records) {
            return records.map((record) => record.id).join('\n');
        }

        function onFilterInput() {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => renderTable(), 120);
        }

        function parseFilterDateTime(value) {
            const raw = String(value || '').trim();
            if (!raw) return null;
            const ms = new Date(raw).getTime();
            return Number.isFinite(ms) ? ms : null;
        }

        function getTimeFilterRange() {
            const fromMs = parseFilterDateTime(document.getElementById('filterTimeFrom').value);
            const toMs = parseFilterDateTime(document.getElementById('filterTimeTo').value);
            return { fromMs, toMs };
        }

        function getResponseTimeMinMs() {
            const el = document.getElementById('responseTimeMin');
            const raw = String(el && el.value || '').trim();
            if (!raw) return null;
            const seconds = Number(raw);
            return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
        }

        function matchCapturedTime(timestamp, fromMs, toMs) {
            if (fromMs == null && toMs == null) return true;
            const ts = Number(timestamp);
            if (!Number.isFinite(ts)) return false;
            if (fromMs != null && ts < fromMs) return false;
            if (toMs != null && ts > toMs) return false;
            return true;
        }

        function clearTimeFilter() {
            document.getElementById('filterTimeFrom').value = '';
            document.getElementById('filterTimeTo').value = '';
            renderTable();
        }

        function renderError(lastError) {
            const banner = document.getElementById('errorBanner');
            if (!lastError || lastError.at <= dismissedErrorAt) {
                banner.hidden = true;
                return;
            }
            banner.hidden = false;
            document.getElementById('errorBannerText').textContent =
                (lastError.scope ? lastError.scope + ': ' : '') + (lastError.message || '未知错误');
        }

        async function dismissError() {
            dismissedErrorAt = Date.now();
            document.getElementById('errorBanner').hidden = true;
            try {
                await fetch('./api/errors/ack', { method: 'POST' });
            } catch (e) {
                // ignore
            }
        }

        function getFilteredRecords() {
            const keyword = document.getElementById('keyword').value.trim().toLowerCase();
            const method = document.getElementById('methodFilter').value;
            const status = document.getElementById('statusFilter').value;
            const hideOptions = document.getElementById('hideOptions').checked;
            const timeRange = getTimeFilterRange();
            const responseTimeMinMs = getResponseTimeMinMs();
            return currentRecords.filter((record) => {
                if (hideOptions && String(record.method).toUpperCase() === 'OPTIONS') return false;
                if (method && String(record.method).toUpperCase() !== method) return false;
                if (!matchStatus(record.responseStatus, status)) return false;
                if (keyword && String(record.url).toLowerCase().indexOf(keyword) === -1) return false;
                if (!matchCapturedTime(record.timestamp, timeRange.fromMs, timeRange.toMs)) return false;
                if (responseTimeMinMs != null) {
                    const durationMs = Number(record.duration);
                    if (!Number.isFinite(durationMs) || durationMs <= responseTimeMinMs) return false;
                }
                return true;
            }).sort((a, b) => {
                const tb = Number(b.timestamp) || 0;
                const ta = Number(a.timestamp) || 0;
                if (tb !== ta) return tb - ta;
                return String(b.id).localeCompare(String(a.id));
            });
        }

        function refreshMethodFilter() {
            const select = document.getElementById('methodFilter');
            const current = select.value;
            const methods = Array.from(new Set(currentRecords.map(r => String(r.method || 'GET').toUpperCase()))).sort();
            select.innerHTML = '<option value="">全部方法</option>' + methods.map(m =>
                `<option value="${escapeHtml(m)}"${m === current ? ' selected' : ''}>${escapeHtml(m)}</option>`
            ).join('');
        }

        function storageMeta(info) {
            const type = (info && info.type) || storageType || 'memory';
            if (info && info.fallback) {
                return {
                    label: 'SQLite',
                    cls: 'fallback',
                    title: '远程数据库不可用，已回退到本机 SQLite。点击切换存储。'
                };
            }
            if (type === 'postgres') {
                const db = (info && info.mysqlDatabase) || '';
                const name = (info && info.mysqlName) || '';
                return {
                    label: db ? 'Postgres · ' + db : 'Postgres',
                    cls: 'mysql',
                    title: '记录写入 PostgreSQL' + (name ? '（' + name + '）' : '') + (db ? ' / ' + db : '') + '。点击切换存储。'
                };
            }
            if (type === 'mysql') {
                const db = (info && info.mysqlDatabase) || '';
                const name = (info && info.mysqlName) || '';
                return {
                    label: db ? 'MySQL · ' + db : 'MySQL',
                    cls: 'mysql',
                    title: '记录写入 MySQL' + (name ? '（' + name + '）' : '') + (db ? ' / ' + db : '') + '。点击切换存储。'
                };
            }
            if (type === 'sqlite') {
                return { label: 'SQLite', cls: 'sqlite', title: '记录持久化在本机 SQLite（data/records.sqlite）。点击切换存储。' };
            }
            if (type === 'json') {
                return { label: 'JSON', cls: 'json', title: 'SQLite 不可用，已回退 JSON 文件（data/records.json）。点击切换存储。' };
            }
            return { label: '内存', cls: 'memory', title: '当前未落盘。点击切换存储。' };
        }

        function mysqlConnections() {
            return dbConnections.filter(function (c) {
                return String(c.type || '').toLowerCase() === 'mysql';
            });
        }

        function remotePersistConnections(engine) {
            var type = engine === 'postgres' ? 'postgres' : 'mysql';
            return dbConnections.filter(function (c) { return c.type === type; });
        }

        function fillPersistRemoteSelect(engine, selectedId) {
            var sel = document.getElementById('persistRemoteConn');
            if (!sel) return;
            var list = remotePersistConnections(engine);
            var label = engine === 'postgres' ? 'PostgreSQL' : 'MySQL';
            sel.innerHTML = list.length
                ? list.map(function (c) {
                    var db = c.database || '(未填库名)';
                    var miss = c.database ? '' : ' — 需填写数据库名';
                    return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name || '') + ' · ' + escapeHtml(db) + miss + '</option>';
                }).join('')
                : '<option value="">暂无 ' + label + ' 连接，请先添加</option>';
            if (selectedId && list.some(function (c) { return c.id === selectedId; })) {
                sel.value = selectedId;
            }
        }

        function currentPersistEngine() {
            if (document.getElementById('persistPostgres').checked) return 'postgres';
            if (document.getElementById('persistMysql').checked) return 'mysql';
            return 'sqlite';
        }

        function onPersistEngineChange() {
            var engine = currentPersistEngine();
            var remote = engine !== 'sqlite';
            document.getElementById('persistRemoteWrap').style.opacity = remote ? '1' : '0.45';
            document.getElementById('persistRemoteConn').disabled = !remote;
            document.getElementById('persistRemoteHint').textContent = engine === 'postgres'
                ? '请选择类型为 PostgreSQL 且已填写数据库名的连接。'
                : (engine === 'mysql'
                    ? '请选择类型为 MySQL 且已填写数据库名的连接。'
                    : '本地 SQLite 无需远程连接。');
            if (remote) {
                fillPersistRemoteSelect(engine, engine === 'postgres'
                    ? captureSettings.postgresConnectionId
                    : captureSettings.mysqlConnectionId);
            }
        }

        async function openStorageModal(options) {
            options = options || {};
            try { await loadDbConnections(); } catch (e) { /* ignore */ }
            var engine = captureSettings.persistEngine || 'sqlite';
            document.getElementById('persistSqlite').checked = engine === 'sqlite';
            document.getElementById('persistMysql').checked = engine === 'mysql';
            document.getElementById('persistPostgres').checked = engine === 'postgres';
            fillPersistRemoteSelect(engine, engine === 'postgres'
                ? captureSettings.postgresConnectionId
                : captureSettings.mysqlConnectionId);
            onPersistEngineChange();
            document.getElementById('storageModalStatus').textContent = '';
            var modal = document.getElementById('storageModal');
            modal.hidden = false;
            if (options.aboveGeneralSettings) {
                modal.classList.add('storage-above-general');
                modal.dataset.aboveGeneralSettings = '1';
            }
        }

        function closeStorageModal() {
            var modal = document.getElementById('storageModal');
            modal.hidden = true;
            if (modal.dataset.aboveGeneralSettings === '1') {
                delete modal.dataset.aboveGeneralSettings;
                modal.classList.remove('storage-above-general');
                if (typeof refreshGeneralSettingsDatasource === 'function') {
                    refreshGeneralSettingsDatasource();
                }
            }
        }

        async function testPersistRemote() {
            var id = document.getElementById('persistRemoteConn').value;
            var status = document.getElementById('storageModalStatus');
            if (!id) { status.textContent = '请先选择连接'; return; }
            status.textContent = '测试中…';
            try {
                var res = await fetch('./api/storage/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connectionId: id })
                });
                var result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '连接失败');
                status.textContent = result.msg || '连接成功';
            } catch (e) {
                status.textContent = '失败：' + (e.message || e);
            }
        }

        async function saveStorageSettings() {
            var engine = currentPersistEngine();
            var remoteId = document.getElementById('persistRemoteConn').value || '';
            var status = document.getElementById('storageModalStatus');
            if (engine !== 'sqlite' && !remoteId) {
                status.textContent = '请选择数据库连接';
                return;
            }
            if (engine !== 'sqlite') {
                var conn = dbConnections.find(function (c) { return c.id === remoteId; });
                if (conn && !conn.database) {
                    status.textContent = '所选连接未填写数据库名';
                    return;
                }
            }
            status.textContent = '保存中…';
            try {
                var payload = { persistEngine: engine };
                if (engine === 'mysql') {
                    payload.mysqlConnectionId = remoteId;
                    payload.postgresConnectionId = '';
                } else if (engine === 'postgres') {
                    payload.postgresConnectionId = remoteId;
                    payload.mysqlConnectionId = '';
                } else {
                    payload.mysqlConnectionId = '';
                    payload.postgresConnectionId = '';
                }
                var res = await fetch('./api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                var result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                if (result.data) applySettings(result.data);
                if (result.storage) storageInfo = result.storage;
                closeStorageModal();
                await loadRecords();
                if (typeof refreshGeneralSettingsDatasource === 'function') {
                    await refreshGeneralSettingsDatasource();
                }
            } catch (e) {
                status.textContent = e.message || String(e);
            }
        }

        function updateStats(filtered) {
            const checked = getCheckedIds().length;
            const parts = [
                '共 ' + currentRecords.length + ' 条',
                '筛选 ' + filtered.length + ' 条',
                '已选 ' + checked + ' 条'
            ];
            if (capturePaused) parts.push('捕获已暂停');
            document.getElementById('statsText').textContent = parts.join(' · ');
            const badge = document.getElementById('storageBadge');
            if (!badge) return;
            const meta = storageMeta(storageInfo);
            badge.hidden = false;
            badge.textContent = meta.label;
            badge.className = 'storage-badge ' + meta.cls;
            badge.title = meta.title;
        }

        async function loadRecords(options) {
            const opts = options || {};
            const seq = ++loadSeq;
            try {
                const response = await fetch(pluginApiUrl('api/records'));
                if (seq !== loadSeq) return { ok: false, stale: true };
                const raw = await response.text();
                let result = null;
                try {
                    result = raw ? JSON.parse(raw) : null;
                } catch (parseErr) {
                    const snip = String(raw || '').replace(/\s+/g, ' ').slice(0, 60);
                    throw new Error('记录接口返回非 JSON（HTTP ' + response.status + '）：' + snip);
                }
                if (!response.ok) throw new Error((result && result.msg) || ('加载失败 HTTP ' + response.status));
                if (seq !== loadSeq) return { ok: false, stale: true };
                if (!result || result.code !== 0) throw new Error((result && result.msg) || '加载失败');
                const nextRecords = result.data || [];
                if (result.storage) storageType = result.storage;
                if (result.storageInfo) storageInfo = result.storageInfo;
                else if (result.storage) storageInfo = { type: result.storage };
                if (result.capture) {
                    capturePaused = Boolean(result.capture.paused);
                    renderCaptureBtn();
                    if (!settingsReady) {
                        applySettings(result.capture);
                        settingsReady = true;
                    }
                }
                renderError(result.lastError);
                const fp = fingerprint(nextRecords);
                const unchanged = fp === recordsFingerprint;
                currentRecords = nextRecords;
                pruneCheckedIds();
                scheduleRefresh();
                if (unchanged) {
                    updateStats(getFilteredRecords());
                    updateSelectAllState();
                    return { ok: true, unchanged: true, count: nextRecords.length };
                }
                recordsFingerprint = fp;
                refreshMethodFilter();
                renderTable();
                return { ok: true, unchanged: false, count: nextRecords.length };
            } catch (e) {
                if (seq !== loadSeq) return { ok: false, stale: true };
                console.error('Failed to load records', e);
                const msg = e && e.message ? e.message : String(e);
                document.getElementById('recordBody').innerHTML =
                    '<tr><td colspan="11" class="empty-state">加载失败：' + escapeHtml(msg) + '</td></tr>';
                return { ok: false, error: msg };
            }
        }

        let refreshFeedbackTimer = 0;

        function setRefreshBtnState(state, text) {
            const btn = document.getElementById('refreshBtn');
            if (!btn) return;
            btn.classList.remove('loading', 'done');
            if (state) btn.classList.add(state);
            btn.disabled = state === 'loading';
            btn.textContent = text || '刷新';
        }

        async function manualRefresh() {
            clearTimeout(refreshFeedbackTimer);
            setRefreshBtnState('loading', '刷新中…');
            const result = await loadRecords({ manual: true });
            if (!result) {
                setRefreshBtnState('', '刷新');
                return;
            }
            if (result.stale) {
                setRefreshBtnState('', '刷新');
                return;
            }
            if (!result.ok) {
                setRefreshBtnState('', '刷新失败');
                refreshFeedbackTimer = setTimeout(() => setRefreshBtnState('', '刷新'), 1600);
                return;
            }
            const tip = result.unchanged
                ? ('已刷新 · 无变化 ' + result.count + ' 条')
                : ('已刷新 · ' + result.count + ' 条');
            setRefreshBtnState('done', '已刷新');
            const btn = document.getElementById('refreshBtn');
            if (btn) btn.title = tip;
            const stats = document.getElementById('statsText');
            if (stats) {
                const base = stats.textContent.replace(/\s*·\s*刚刚刷新.*$/, '');
                stats.textContent = base + ' · 刚刚刷新';
            }
            refreshFeedbackTimer = setTimeout(() => {
                setRefreshBtnState('', '刷新');
                if (btn) btn.title = '重新加载捕获列表';
            }, 1200);
        }

        function ensureVirtualScroll() {
            if (virtualScrollBound) return;
            const container = document.querySelector('.table-container');
            if (!container) return;
            virtualScrollBound = true;
            let ticking = false;
            container.addEventListener('scroll', () => {
                if (ticking) return;
                ticking = true;
                requestAnimationFrame(() => {
                    ticking = false;
                    renderVirtualRows(false);
                });
            }, { passive: true });
        }

        function buildRecordRow(record, maxDuration) {
            const date = new Date(record.timestamp);
            const timeStr = Number.isFinite(date.getTime())
                ? (function () {
                    const now = new Date();
                    const sameDay = date.getFullYear() === now.getFullYear()
                        && date.getMonth() === now.getMonth()
                        && date.getDate() === now.getDate();
                    const hhmmss = date.toTimeString().slice(0, 8);
                    if (sameDay) return hhmmss;
                    const mm = String(date.getMonth() + 1).padStart(2, '0');
                    const dd = String(date.getDate()).padStart(2, '0');
                    return mm + '-' + dd + ' ' + hhmmss;
                })()
                : '-';
            const status = record.responseStatus || '-';
            const method = String(record.method || 'GET').toUpperCase();
            const methodClass = /^[A-Z]+$/.test(method) ? method : 'GET';
            const urlProtocol = String(record.url || '').split(':', 1)[0].toLowerCase();
            const protocolHint = String(record.proto || record.protocolHint || '').toLowerCase();
            const proto = protocolHint === 'websocket'
                ? (urlProtocol === 'https' || urlProtocol === 'wss' ? 'wss' : 'ws')
                : protocolHint === 'grpc' || record.grpcHint
                    ? 'grpc'
                    : protocolHint === 'http' || protocolHint === 'https'
                        ? protocolHint
                        : urlProtocol === 'https' || urlProtocol === 'wss' ? 'https' : 'http';
            const checked = checkedIdSet.has(String(record.id)) ? ' checked' : '';
            const selected = String(record.id) === String(selectedId) ? ' selected' : '';
            const uploadMark = record.hasUpload ? ' 📎' : '';
            let protocolBadge = '';
            if (record.protocolHint === 'websocket' || record.wsHandshake) {
                protocolBadge = '<span class="proto-badge proto-ws" title="WebSocket 握手">WS</span>';
            } else if (record.protocolHint === 'grpc' || record.grpcHint) {
                protocolBadge = '<span class="proto-badge proto-grpc" title="gRPC over HTTP">gRPC</span>';
            }
            const name = record.name || '-';
            const kind = record.resourceType || 'xhr';
            const typeText = record.mimeType || '';
            const iconChar = kind === 'json' ? '{}' : kind === 'document' ? 'H' : kind === 'script' ? 'JS' : '{}';
            const initiator = record.initiator || 'Other';
            const initiatorUrl = record.initiatorUrl || '';
            const initiatorHtml = initiatorUrl
                ? `<span class="initiator-link" title="${escapeHtml(initiatorUrl)}">${escapeHtml(initiator)}</span>`
                : `<span class="initiator-other">${escapeHtml(initiator)}</span>`;
            const TIMING_ALERT_MS = 3000;
            const duration = record.duration;
            const hasTiming = duration != null && Number.isFinite(Number(duration)) && Number(duration) >= 0;
            const durationMsVal = hasTiming ? Number(duration) : 0;
            const timingAlert = hasTiming && durationMsVal >= TIMING_ALERT_MS;
            const barWidth = maxDuration && durationMsVal ? Math.max(4, Math.round(durationMsVal / maxDuration * 40)) : 0;
            const timingHtml = hasTiming
                ? `<div class="timing-wrap${timingAlert ? ' timing-alert' : ''}">${barWidth ? '<span class="timing-bar" style="width:' + barWidth + 'px"></span>' : ''}<span class="timing-text" title="请求开始至响应结束${timingAlert ? '，超过 3 秒' : ''}">${escapeHtml(formatTiming(durationMsVal))}</span></div>`
                : `<span class="timing-text" title="无耗时数据">-</span>`;
            const sizeTitle = '响应 ' + formatNetworkSize(record.size);
            return `
                    <tr class="${selected}" data-id="${escapeHtml(record.id)}" onclick="onRowClick(event)">
                        <td><input type="checkbox" class="record-cb" value="${escapeHtml(record.id)}"${checked} onclick="onRecordCheck(event, this.value)"></td>
                        <td class="proto-col"><span class="proto-badge proto-${escapeHtml(proto)}" title="协议">${escapeHtml(proto)}</span></td>
                        <td><span class="method ${escapeHtml(methodClass)}">${escapeHtml(method)}</span></td>
                        <td class="url-col" title="${escapeHtml(record.url)}">${protocolBadge}${escapeHtml(record.url)}${uploadMark}</td>
                        <td class="name-col" title="${escapeHtml(name)}">
                            <span class="name-cell"><span class="name-icon ${escapeHtml(kind)}">${iconChar}</span><span class="name-text">${escapeHtml(name)}</span></span>
                        </td>
                        <td class="type-col" title="${escapeHtml(typeText)}">${escapeHtml(typeText)}</td>
                        <td class="initiator-col">${initiatorHtml}</td>
                        <td class="size-col" title="${escapeHtml(sizeTitle)}">${escapeHtml(formatNetworkSize(record.size))}</td>
                        <td class="timing-col">${timingHtml}</td>
                        <td><span class="status ${statusClass(status)}">${escapeHtml(status)}</span></td>
                        <td>${timeStr}</td>
                    </tr>
                `;
        }

        function renderVirtualRows(updateStatsFlag) {
            const tbody = document.getElementById('recordBody');
            const container = tbody.closest('.table-container');
            const filtered = filteredCache;

            if (filtered.length === 0) {
                document.getElementById('selectAll').checked = false;
                tbody.innerHTML = `<tr><td colspan="11" class="empty-state">${
                    currentRecords.length === 0
                        ? '暂无捕获记录。请确认代理和插件规则已生效。'
                        : '没有符合筛选条件的记录。'
                }</td></tr>`;
                if (updateStatsFlag !== false) updateStats(filtered);
                return;
            }

            const maxDuration = filteredMaxDuration;
            let html;
            if (filtered.length <= VIRTUAL_THRESHOLD) {
                html = filtered.map((record) => buildRecordRow(record, maxDuration)).join('');
            } else {
                const scrollTop = container ? container.scrollTop : 0;
                const viewH = container ? container.clientHeight : 320;
                const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_OVERSCAN);
                const visible = Math.ceil(viewH / ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
                const end = Math.min(filtered.length, start + visible);
                const topPad = start * ROW_HEIGHT;
                const bottomPad = Math.max(0, (filtered.length - end) * ROW_HEIGHT);
                html =
                    `<tr class="virt-pad" aria-hidden="true"><td colspan="11" style="height:${topPad}px"></td></tr>` +
                    filtered.slice(start, end).map((record) => buildRecordRow(record, maxDuration)).join('') +
                    `<tr class="virt-pad" aria-hidden="true"><td colspan="11" style="height:${bottomPad}px"></td></tr>`;
            }
            tbody.innerHTML = html;
            updateSelectAllState();
            if (updateStatsFlag !== false) updateStats(filtered);
        }

        function renderTable() {
            ensureVirtualScroll();
            const tbody = document.getElementById('recordBody');
            const container = tbody.closest('.table-container');
            const scrollTop = container ? container.scrollTop : 0;
            const stayOnNewest = !container || scrollTop < 48;
            let anchorId = null;
            if (!stayOnNewest && container) {
                const rows = container.querySelectorAll('tr[data-id]');
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i].offsetTop + rows[i].offsetHeight > scrollTop) {
                        anchorId = rows[i].getAttribute('data-id');
                        break;
                    }
                }
            }

            filteredCache = getFilteredRecords();
            filteredMaxDuration = filteredCache.reduce((max, item) => {
                const n = Number(item.duration) || 0;
                return n > max ? n : max;
            }, 0);

            renderVirtualRows(true);
            if (!container) return;
            if (stayOnNewest) {
                container.scrollTop = 0;
                return;
            }
            if (anchorId) {
                const idx = filteredCache.findIndex((record) => String(record.id) === String(anchorId));
                if (idx >= 0) {
                    container.scrollTop = idx * ROW_HEIGHT;
                    renderVirtualRows(false);
                    return;
                }
            }
            container.scrollTop = scrollTop;
        }

        function onCheckChange() {
            updateSelectAllState();
            updateStats(filteredCache.length ? filteredCache : getFilteredRecords());
        }

        function onRowClick(event) {
            const id = event.currentTarget.getAttribute('data-id');
            if (!id) return;
            selectedId = id;
            document.querySelectorAll('tr.selected').forEach(tr => tr.classList.remove('selected'));
            const row = event.currentTarget;
            if (row) row.classList.add('selected');
            loadDetail(id);
        }

        async function loadDetail(id) {
            const seq = ++detailSeq;
            const panel = document.getElementById('detailPanel');
            panel.innerHTML = '<h3>请求详情</h3><p class="hint">加载中...</p>';
            try {
                const res = await fetch('./api/records/' + encodeURIComponent(id));
                if (seq !== detailSeq) return;
                const result = await res.json();
                if (seq !== detailSeq) return;
                if (!res.ok || !result.data) throw new Error(result.msg || 'not found');
                const record = result.data;
                selectedRecord = record;
                const reqHeaders = JSON.stringify(record.requestHeaders || {}, null, 2);
                const resHeaders = JSON.stringify(record.responseHeaders || {}, null, 2);
                const reqBodyCanFormat = !record.requestBodyBinary && !record.multipart;
                let reqBodyText = record.requestBodyBinary ? '[binary]' : (formatBody(record.requestBody) || '(empty)');
                if (record.multipart) {
                    const fields = JSON.stringify(record.multipart.fields || [], null, 2);
                    const files = (record.multipart.files || [])
                        .map((f) => `${f.name}: ${f.filename} (${f.path})`)
                        .join('\n');
                    reqBodyText = `multipart fields:\n${fields}\n\nfiles:\n${files || '(none)'}`;
                }
                const resBodyCanFormat = !record.responseBodyBinary;
                const resBodyText = record.responseBodyBinary ? '[binary]' : (formatBody(record.responseBody) || '(empty)');
                copyPayloads.reqMeta = `${record.method} ${record.url}`;
                copyPayloads.resMeta = `Status ${record.responseStatus || '-'}`;
                const protoLine = record.protocolHint && record.protocolHint !== 'http'
                    ? `<p class="hint proto-hint">${escapeHtml(record.protocolNote || ('协议: ' + record.protocolHint))}</p>`
                    : '';
                panel.innerHTML = `
                    <h3>${escapeHtml(record.method)} ${escapeHtml(record.url)}</h3>
                    <p class="hint">请求体 ${record.requestBodyBinary ? 'binary' : formatSize(BufferLike(record.requestBody))} · 响应体 ${record.responseBodyBinary ? 'binary' : formatSize(BufferLike(record.responseBody))} · 状态 ${escapeHtml(record.responseStatus || '-')} · 报文可编辑后复制，不会写回捕获记录</p>
                    ${protoLine}
                    <div class="detail-grid">
                        <div class="msg-col">
                            <div class="msg-col-head">
                                <h3>请求报文</h3>
                                <span class="msg-col-spacer"></span>
                                <button type="button" class="btn-copy" onclick="copyPayload('reqDump', this)">复制请求报文</button>
                            </div>
                            ${renderMsgBlock('Request Headers', reqHeaders, 'reqHeaders', true)}
                            ${renderMsgBlock('Request Body', reqBodyText, 'reqBody', reqBodyCanFormat)}
                        </div>
                        <div class="msg-col">
                            <div class="msg-col-head">
                                <h3>响应报文</h3>
                                <div class="post-op-wrap">
                                    <button type="button" class="btn-rules" id="postOpBtn" onclick="togglePostOpMenu(event)">后置操作</button>
                                    <div class="post-op-menu" id="postOpMenu" hidden>
                                        <div class="menu-label">新增</div>
                                        <button type="button" onclick="openExtractModal()">提取变量</button>
                                        <button type="button" onclick="openAssertModal()">断言</button>
                                        <button type="button" onclick="openDbOpModal()">数据库操作</button>
                                    </div>
                                </div>
                                <span class="msg-col-spacer"></span>
                                <button type="button" class="btn-copy" onclick="copyPayload('resDump', this)">复制响应报文</button>
                            </div>
                            ${renderMsgBlock('Response Headers', resHeaders, 'resHeaders', true)}
                            ${renderMsgBlock('Response Body', resBodyText, 'resBody', resBodyCanFormat)}
                        </div>
                    </div>
                `;
                refreshPostOpBadge();
            } catch (e) {
                if (seq !== detailSeq) return;
                panel.innerHTML = '<h3>请求详情</h3><p class="hint">加载失败</p>';
            }
        }

        function BufferLike(text) {
            try {
                return new Blob([String(text || '')]).size;
            } catch (e) {
                return String(text || '').length;
            }
        }

        function toJsonPathParts(parts) {
            let path = '$';
            (parts || []).forEach((part) => {
                if (typeof part === 'number') path += '[' + part + ']';
                else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) path += '.' + part;
                else path += '[' + JSON.stringify(String(part)) + ']';
            });
            return path;
        }

        function lastJsonPathKey(expr) {
            const s = String(expr || '');
            const quoted = s.match(/\[['"]([^'"]+)['"]\]\s*$/);
            if (quoted) return quoted[1];
            const index = s.match(/\[(\d+|\*)\]\s*$/);
            if (index) return index[1] === '*' ? 'item' : ('item' + index[1]);
            const dot = s.match(/\.([A-Za-z_][A-Za-z0-9_]*)\s*$/);
            if (dot) return dot[1];
            return 'extracted';
        }

        function closePostOpMenu() {
            const menu = document.getElementById('postOpMenu');
            if (menu) menu.hidden = true;
        }

        function togglePostOpMenu(event) {
            event.stopPropagation();
            const menu = document.getElementById('postOpMenu');
            if (!menu) return;
            menu.hidden = !menu.hidden;
        }

        async function refreshPostOpBadge() {
            const btn = document.getElementById('postOpBtn');
            if (!btn || !selectedId) return;
            try {
                const [extractRes, assertRes, dbRes] = await Promise.all([
                    fetch('./api/extract-vars?recordId=' + encodeURIComponent(selectedId)),
                    fetch('./api/assertions?recordId=' + encodeURIComponent(selectedId)),
                    fetch('./api/db-ops?recordId=' + encodeURIComponent(selectedId))
                ]);
                const extractJson = await extractRes.json();
                const assertJson = await assertRes.json();
                const dbJson = await dbRes.json();
                const extractCount = ((extractJson.data && extractJson.data.items) || []).length;
                const assertCount = ((assertJson.data && assertJson.data.items) || []).length;
                const dbCount = ((dbJson.data && dbJson.data.items) || []).length;
                const total = extractCount + assertCount + dbCount;
                btn.classList.toggle('has-items', total > 0);
                btn.textContent = total ? ('后置操作 (' + total + ')') : '后置操作';
            } catch (e) {
                btn.textContent = '后置操作';
            }
        }

        function sourceTree() {
            return document.getElementById(activeSourceTreeId) || document.getElementById('jpTree');
        }

        function isAssertModalOpen() {
            const modal = document.getElementById('assertModal');
            return Boolean(modal && !modal.hidden);
        }

        function isDbOpModalOpen() {
            const modal = document.getElementById('dbOpModal');
            return Boolean(modal && !modal.hidden);
        }

        function currentExtractMethod() {
            const checked = document.querySelector('input[name="extractMethod"]:checked');
            return checked ? checked.value : 'jsonpath';
        }

        function headerToVarName(name) {
            let out = String(name || '').replace(/[^A-Za-z0-9_]/g, '_');
            if (!out) out = 'extracted';
            if (!/^[A-Za-z_]/.test(out)) out = 'var_' + out;
            return out.slice(0, 60);
        }

        function onExtractSourceChange() {
            syncExtractSourceView();
            scheduleExtractPreview();
        }

        function onExtractMethodChange() {
            if (currentExtractMethod() === 'whole') {
                document.getElementById('extractJsonPath').value = '$';
            }
            syncExtractSourceView();
            scheduleExtractPreview();
        }

        function syncExtractSourceView() {
            const source = document.getElementById('extractSource').value;
            const jsonpath = source === 'json' && currentExtractMethod() === 'jsonpath';
            document.getElementById('extractMethodWrap').hidden = source !== 'json';
            document.getElementById('extractHeaderWrap').hidden = source !== 'header';
            document.getElementById('jpJsonFields').hidden = !jsonpath;
            document.getElementById('jpTool').hidden = false;
            const left = document.getElementById('jpLeftTitle');
            const right = document.getElementById('jpRightTitle');
            const hint = document.getElementById('jpHint');
            if (source === 'header') {
                left.textContent = 'Response Headers';
                right.textContent = 'Header';
                hint.textContent = '可以在左侧悬停于一个响应头上点击「提取响应头」来快速填写名称';
                fillExtractHeaders();
                return;
            }
            if (source === 'text') {
                left.textContent = 'Response Text';
                right.textContent = 'Text';
                hint.textContent = '将提取完整响应正文。';
                fillExtractText();
                return;
            }
            left.textContent = 'JSON';
            right.textContent = jsonpath ? 'JSONPath' : 'JSON';
            hint.textContent = jsonpath
                ? '可以在左侧悬停于一个字段上点击「提取 JSONPath」来快速填写'
                : '将提取完整 JSON 响应体。';
            fillExtractJsonTree();
        }

        function bindExtractTreeClicks() {
            const tree = sourceTree();
            if (!tree) return;
            tree.onclick = function (event) {
                const btn = event.target && event.target.closest && event.target.closest('.jp-extract');
                if (!btn) return;
                event.preventDefault();
                const header = btn.getAttribute('data-header');
                if (header) applyExtractHeader(header);
                else applyExtractPath(btn.getAttribute('data-path'));
            };
        }

        function fillExtractHeaders() {
            const tree = sourceTree();
            const headers = (selectedRecord && selectedRecord.responseHeaders) || {};
            const keys = Object.keys(headers);
            if (!keys.length) {
                tree.innerHTML = '<p class="hint">当前响应没有可展示的响应头。</p>';
                bindExtractTreeClicks();
                return;
            }
            tree.innerHTML = keys.map((key) => {
                const raw = headers[key];
                const val = Array.isArray(raw) ? raw.join(', ') : String(raw == null ? '' : raw);
                return '<div class="jp-node">' +
                    '<span class="jp-key">' + escapeHtml(key) + '</span>: ' +
                    '<span class="jp-str">' + escapeHtml(val) + '</span>' +
                    '<button type="button" class="jp-extract" data-header="' + escapeHtml(key) +
                    '" onclick="event.preventDefault(); event.stopPropagation(); applyExtractHeader(this.getAttribute(\'data-header\'))">提取响应头</button>' +
                    '</div>';
            }).join('');
            bindExtractTreeClicks();
        }

        function fillExtractText() {
            const tree = sourceTree();
            const text = selectedRecord && !selectedRecord.responseBodyBinary
                ? String(selectedRecord.responseBody == null ? '' : selectedRecord.responseBody)
                : '[binary]';
            tree.innerHTML = text
                ? '<pre style="margin:0;white-space:pre-wrap;word-break:break-all">' + escapeHtml(text) + '</pre>'
                : '<p class="hint">响应体为空。</p>';
            bindExtractTreeClicks();
        }

        function onExtractJsonPathInput() {
            const expr = document.getElementById('extractJsonPath').value.trim();
            const name = document.getElementById('extractVarName');
            if (!editingExtractId && expr && (!name.value || name.dataset.auto !== '0')) {
                name.value = lastJsonPathKey(expr);
                name.dataset.auto = '1';
            }
            scheduleExtractPreview();
        }

        function renderJsonTree(value, parts) {
            jpNodeCount += 1;
            if (jpNodeCount > 400) return '<span class="hint">…</span>';
            if (value === null) return '<span class="jp-num">null</span>';
            if (typeof value === 'number' || typeof value === 'boolean') {
                return '<span class="jp-num">' + escapeHtml(String(value)) + '</span>' + extractBtn(parts);
            }
            if (typeof value !== 'object') {
                return '<span class="jp-str">"' + escapeHtml(String(value)) + '"</span>' + extractBtn(parts);
            }
            if (Array.isArray(value)) {
                if (!value.length) return '[]';
                const rows = value.map((item, idx) => {
                    const next = parts.concat(idx);
                    return '<div class="jp-node" data-path="' + escapeHtml(toJsonPathParts(next)) + '">' +
                        '<span class="jp-key">' + idx + '</span>: ' + renderJsonTree(item, next) + '</div>';
                });
                return '[<div style="padding-left:14px">' + rows.join('') + '</div>]' + extractBtn(parts);
            }
            const keys = Object.keys(value);
            if (!keys.length) return '{}';
            const rows = keys.map((key) => {
                const next = parts.concat(key);
                return '<div class="jp-node" data-path="' + escapeHtml(toJsonPathParts(next)) + '">' +
                    '<span class="jp-key">"' + escapeHtml(key) + '"</span>: ' + renderJsonTree(value[key], next) + '</div>';
            });
            return '{<div style="padding-left:14px">' + rows.join('') + '</div>}' + extractBtn(parts);
        }

        function extractBtn(parts) {
            if (!parts.length) return '';
            const handler = activeSourceTreeId === 'dbJpTree' ? 'applyDbExtractPath' : 'applyExtractPath';
            return '<button type="button" class="jp-extract" data-path="' + escapeHtml(toJsonPathParts(parts)) +
                '" onclick="event.preventDefault(); event.stopPropagation(); ' + handler + '(this.getAttribute(\'data-path\'))">提取 JSONPath</button>';
        }

        function fillExtractJsonTree() {
            const tree = sourceTree();
            const body = selectedRecord && !selectedRecord.responseBodyBinary ? selectedRecord.responseBody : '';
            jpNodeCount = 0;
            try {
                const parsed = JSON.parse(String(body || '').replace(/^\uFEFF/, '').trim());
                tree.innerHTML = renderJsonTree(parsed, []);
            } catch (e) {
                tree.innerHTML = '<p class="hint">当前响应不是 JSON，无法使用 JSONPath 工具。可改用 Response Header / Text。</p>';
            }
            bindExtractTreeClicks();
        }

        function applyExtractPath(path) {
            if (isDbOpModalOpen()) {
                applyDbExtractPath(path);
                return;
            }
            if (isAssertModalOpen()) {
                applyAssertPath(path);
                return;
            }
            const expr = String(path || '').trim();
            if (!expr) return;
            const input = document.getElementById('extractJsonPath');
            const jsonpathRadio = document.querySelector('input[name="extractMethod"][value="jsonpath"]');
            if (jsonpathRadio) jsonpathRadio.checked = true;
            document.getElementById('extractSource').value = 'json';
            input.value = expr;
            const name = document.getElementById('extractVarName');
            if (!name.value || name.dataset.auto !== '0') {
                name.value = lastJsonPathKey(expr);
                name.dataset.auto = '1';
            }
            onExtractSourceChange();
            input.focus();
            input.select();
            scheduleExtractPreview();
        }

        function applyExtractHeader(name) {
            if (isAssertModalOpen()) {
                applyAssertHeader(name);
                return;
            }
            const header = String(name || '').trim();
            if (!header) return;
            document.getElementById('extractSource').value = 'header';
            document.getElementById('extractHeaderName').value = header;
            const varInput = document.getElementById('extractVarName');
            if (!varInput.value || varInput.dataset.auto !== '0') {
                varInput.value = headerToVarName(header);
                varInput.dataset.auto = '1';
            }
            document.getElementById('extractHeaderName').focus();
            scheduleExtractPreview();
        }

        function selectedRecordSnapshot() {
            if (!selectedRecord) return {};
            return {
                responseBody: selectedRecord.responseBody,
                responseHeaders: selectedRecord.responseHeaders || {},
                responseStatus: selectedRecord.responseStatus
            };
        }

        function withRecordSnapshot(payload) {
            return Object.assign({ recordId: selectedId }, selectedRecordSnapshot(), payload || {});
        }

        function formatPostOpSave(okText, result) {
            const data = result && result.data ? result.data : {};
            if (data.mysql) return (okText || '已保存') + '，并已写入 MySQL ' + (data.mysqlDatabase || '');
            if (data.mysqlError) return (okText || '已保存') + '；写入 MySQL 失败：' + data.mysqlError;
            if (data.mysqlSkipped || (captureSettings.persistEngine !== 'mysql')) {
                return (okText || '已保存') + '（本机 SQLite）。要同步到 MySQL，请点击存储徽章切换为 MySQL';
            }
            return okText || '已保存';
        }

        function scheduleExtractPreview() {
            clearTimeout(extractPreviewTimer);
            extractPreviewTimer = setTimeout(runExtractPreview, 180);
        }

        async function runExtractPreview() {
            const out = document.getElementById('jpResult');
            if (!selectedId && !selectedRecord) {
                out.textContent = '请先选择一条记录';
                return;
            }
            const payload = collectExtractForm();
            const local = previewExtractLocal(payload);
            if (local) {
                out.textContent = local.ok ? (local.preview || '(empty)') : (local.error || '未匹配到结果');
            }
            try {
                const res = await fetch('./api/extract-vars/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(withRecordSnapshot(payload))
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '预览失败');
                const data = result.data || {};
                out.textContent = data.ok ? (data.preview || '(empty)') : (data.error || '未匹配到结果');
            } catch (e) {
                if (!local) out.textContent = e.message || '预览失败';
            }
        }

        function previewExtractLocal(payload) {
            if (!selectedRecord) return null;
            const item = payload || {};
            try {
                if (item.source === 'header') {
                    const headers = selectedRecord.responseHeaders || {};
                    const name = String(item.headerName || '').toLowerCase();
                    let value = '';
                    Object.keys(headers).forEach((key) => {
                        if (String(key).toLowerCase() === name) value = String(headers[key] == null ? '' : headers[key]);
                    });
                    if (!value) return { ok: false, error: '响应头 ' + item.headerName + ' 不存在' };
                    return { ok: true, preview: value };
                }
                const text = String(selectedRecord.responseBody == null ? '' : selectedRecord.responseBody);
                if (item.source === 'text' || item.method === 'whole' || item.jsonPath === '$') {
                    if (!text) return { ok: false, error: '响应体为空' };
                    return { ok: true, preview: text.length > 4000 ? text.slice(0, 4000) + '…' : text };
                }
                const parsed = JSON.parse(text.replace(/^\uFEFF/, '').trim());
                const value = walkSimpleJsonPath(parsed, item.jsonPath || '$');
                if (value === undefined) return null;
                if (value !== null && typeof value === 'object') {
                    return { ok: true, preview: JSON.stringify(value, null, 2) };
                }
                return { ok: true, preview: String(value) };
            } catch (e) {
                return null;
            }
        }

        function walkSimpleJsonPath(root, expr) {
            const s = String(expr || '').trim();
            if (!s || s === '$') return root;
            if (!s.startsWith('$')) return undefined;
            let cur = root;
            let i = 1;
            while (i < s.length) {
                if (cur == null) return undefined;
                const ch = s[i];
                if (ch === ' ' || ch === '\t') { i += 1; continue; }
                if (ch === '.' && s[i + 1] === '.') return undefined;
                if (ch === '.') {
                    i += 1;
                    if (s[i] === '*') return undefined;
                    if (!/[A-Za-z_]/.test(s[i] || '')) return undefined;
                    const start = i;
                    i += 1;
                    while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) i += 1;
                    cur = cur[s.slice(start, i)];
                    continue;
                }
                if (ch === '[') {
                    i += 1;
                    while (s[i] === ' ') i += 1;
                    if (s[i] === '*' ) return undefined;
                    if (s[i] === '"' || s[i] === "'") {
                        const quote = s[i];
                        i += 1;
                        let key = '';
                        while (i < s.length && s[i] !== quote) {
                            key += s[i];
                            i += 1;
                        }
                        i += 1;
                        if (s[i] !== ']') return undefined;
                        i += 1;
                        cur = cur[key];
                        continue;
                    }
                    let num = '';
                    while (i < s.length && /[0-9]/.test(s[i])) {
                        num += s[i];
                        i += 1;
                    }
                    if (!num || s[i] !== ']') return undefined;
                    i += 1;
                    cur = cur[Number(num)];
                    continue;
                }
                return undefined;
            }
            return cur;
        }

        function collectExtractForm() {
            const source = document.getElementById('extractSource').value;
            const method = currentExtractMethod();
            const rawPath = document.getElementById('extractJsonPath').value.trim();
            return {
                id: editingExtractId || undefined,
                varName: document.getElementById('extractVarName').value.trim(),
                source,
                method: source === 'json' ? method : source,
                jsonPath: method === 'whole' ? '$' : rawPath,
                headerName: document.getElementById('extractHeaderName').value.trim(),
                arrayUnpack: document.getElementById('extractUnpack').checked
            };
        }

        function clearExtractFieldError(id) {
            const el = document.getElementById(id);
            if (el) el.classList.remove('field-invalid');
            const status = document.getElementById('extractStatus');
            if (status && status.classList.contains('is-error')) {
                status.textContent = '';
                status.classList.remove('is-error');
            }
        }

        function clearExtractFieldErrors() {
            ['extractVarName', 'extractJsonPath', 'extractHeaderName'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('field-invalid');
            });
        }

        function markExtractFieldError(id, message) {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('field-invalid');
                try { el.focus(); } catch (e) { /* ignore */ }
            }
            const status = document.getElementById('extractStatus');
            status.classList.remove('is-ok');
            status.classList.add('is-error');
            status.textContent = message;
        }

        function isValidExtractVarName(name) {
            return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ''));
        }

        function validateExtractForm(form) {
            clearExtractFieldErrors();
            if (!form.varName) {
                return { ok: false, field: 'extractVarName', message: '请填写变量名称' };
            }
            if (!isValidExtractVarName(form.varName)) {
                return {
                    ok: false,
                    field: 'extractVarName',
                    message: '变量名称仅支持字母、数字、下划线，且不能以数字开头'
                };
            }
            if (form.source === 'json' && form.method === 'jsonpath') {
                const expr = String(form.jsonPath || '').trim();
                if (!expr) {
                    return { ok: false, field: 'extractJsonPath', message: '请填写表达式' };
                }
                if (expr === '$') {
                    return {
                        ok: false,
                        field: 'extractJsonPath',
                        message: '请填写具体 JSONPath（如 $.data.id），不能仅为 $；提取整份 JSON 请选「整个 JSON」'
                    };
                }
                if (!expr.startsWith('$')) {
                    return {
                        ok: false,
                        field: 'extractJsonPath',
                        message: '表达式应以 $ 开头，例如 $.data.id'
                    };
                }
            }
            if (form.source === 'header' && !form.headerName) {
                return { ok: false, field: 'extractHeaderName', message: '请填写响应头名称' };
            }
            return { ok: true };
        }

        async function saveExtractItem() {
            const form = collectExtractForm();
            const check = validateExtractForm(form);
            if (!check.ok) {
                markExtractFieldError(check.field, check.message);
                return;
            }
            const next = extractItems.slice();
            let idx = -1;
            if (editingExtractId) idx = next.findIndex((item) => item.id === editingExtractId);
            if (idx < 0) idx = next.findIndex((item) => sameExtract(item, form));
            const updating = idx >= 0;
            if (updating) {
                next[idx] = Object.assign({}, next[idx], form, { id: next[idx].id });
            } else {
                next.push(form);
            }
            await persistExtractItems(next, updating ? '已更新，未新增重复项' : '已保存，导出 JMX 时生效');
            const saved = extractItems.find((item) => sameExtract(item, form)) || extractItems[extractItems.length - 1];
            editingExtractId = saved && saved.id ? saved.id : '';
            document.getElementById('extractVarName').dataset.auto = '0';
        }

        function renderExtractList() {
            const tbody = document.getElementById('extractListBody');
            if (!extractItems.length) {
                tbody.innerHTML = '<tr><td colspan="4" class="empty-state">尚未添加</td></tr>';
                return;
            }
            tbody.innerHTML = extractItems.map((item) => {
                const expr = item.source === 'header' ? (item.headerName || '') : (item.method === 'whole' ? '$' : (item.jsonPath || ''));
                return '<tr>' +
                    '<td>' + escapeHtml(item.varName) + '</td>' +
                    '<td>' + escapeHtml(item.source === 'json' ? 'JSON' : (item.source === 'header' ? 'Header' : 'Text')) + '</td>' +
                    '<td>' + escapeHtml(expr) + (item.arrayUnpack ? ' · 解包' : '') + '</td>' +
                    '<td><button type="button" onclick="editExtractItem(\'' + escapeHtml(item.id) + '\')">编辑</button> ' +
                    '<button type="button" onclick="deleteExtractItem(\'' + escapeHtml(item.id) + '\')">删除</button></td>' +
                    '</tr>';
            }).join('');
        }

        async function loadExtractItems() {
            if (!selectedId) return;
            const res = await fetch('./api/extract-vars?recordId=' + encodeURIComponent(selectedId));
            const result = await res.json();
            extractItems = (result.data && result.data.items) || [];
            renderExtractList();
            refreshPostOpBadge();
        }

        // bootstrap-ui.js 须在本文件之前加载；初始化放在 loadRecords 定义之后
        initDetailPanelResizer();
        loadRecords();
        scheduleRefresh();
        window.addEventListener('pageshow', function (e) {
            if (e.persisted && typeof loadRecords === 'function') loadRecords();
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && autoRefresh) loadRecords();
        });
