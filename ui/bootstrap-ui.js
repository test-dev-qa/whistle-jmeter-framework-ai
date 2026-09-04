'use strict';
// Bootstrap: capture settings, refresh, export

        let appToastTimer = 0;

        function showAppToast(message, type) {
            const el = document.getElementById('appToast');
            if (!el) return;
            if (appToastTimer) {
                clearTimeout(appToastTimer);
                appToastTimer = 0;
            }
            const kind = type === 'error' ? 'error' : (type === 'info' ? 'info' : 'ok');
            el.textContent = String(message || '');
            el.className = 'app-toast is-' + kind;
            el.hidden = false;
            requestAnimationFrame(function () {
                el.classList.add('is-visible');
            });
            appToastTimer = setTimeout(function () {
                el.classList.remove('is-visible');
                appToastTimer = setTimeout(function () {
                    el.hidden = true;
                    appToastTimer = 0;
                }, 200);
            }, kind === 'error' ? 3200 : 2400);
        }

        function applySettings(capture) {
            document.getElementById('includeHost').value = capture.includeHost || '';
            document.getElementById('includePath').value = capture.includePath || '';
            document.getElementById('skipDuplicates').checked = capture.skipDuplicates !== false;
            capturePaused = Boolean(capture.paused);
            captureSettings.persistEngine = capture.persistEngine === 'mysql'
                ? 'mysql'
                : (capture.persistEngine === 'postgres' ? 'postgres' : 'sqlite');
            captureSettings.mysqlConnectionId = capture.mysqlConnectionId || '';
            captureSettings.postgresConnectionId = capture.postgresConnectionId || '';
            renderCaptureBtn();
        }

        function renderCaptureBtn() {
            const btn = document.getElementById('captureBtn');
            btn.textContent = capturePaused ? '继续捕获' : '暂停捕获';
            btn.classList.toggle('on', capturePaused);
        }

        async function saveSettings(extra) {
            const payload = Object.assign({
                paused: capturePaused,
                includeHost: document.getElementById('includeHost').value,
                includePath: document.getElementById('includePath').value,
                skipDuplicates: document.getElementById('skipDuplicates').checked
            }, extra || {});
            try {
                const res = await fetch('./api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                if (result.data) applySettings(result.data);
                if (result.storage) storageInfo = result.storage;
            } catch (e) {
                console.error('Failed to save settings', e);
            }
        }

        function toggleCapture() {
            capturePaused = !capturePaused;
            renderCaptureBtn();
            updateStats(getFilteredRecords());
            saveSettings({ paused: capturePaused });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!document.getElementById('dbConnFormModal').hidden) {
                closeDbConnForm();
                return;
            }
            if (!document.getElementById('generalSettingsModal').hidden) {
                closeGeneralSettingsModal();
                return;
            }
            if (!document.getElementById('storageModal').hidden) {
                closeStorageModal();
                return;
            }
            if (!document.getElementById('dbOpModal').hidden) {
                closeDbOpModal();
                return;
            }
            if (!document.getElementById('extractModal').hidden) {
                closeExtractModal();
                return;
            }
            if (!document.getElementById('assertModal').hidden) {
                closeAssertModal();
                return;
            }
            if (!document.getElementById('correlateModal').hidden) {
                closeCorrelateModal();
                return;
            }
            if (!document.getElementById('rulesModal').hidden) {
                closeRulesModal();
            }
        });

        function toggleAll(checkbox) {
            const filtered = filteredCache.length ? filteredCache : getFilteredRecords();
            if (checkbox.checked) {
                filtered.forEach((record) => checkedIdSet.add(String(record.id)));
            } else {
                filtered.forEach((record) => checkedIdSet.delete(String(record.id)));
            }
            renderVirtualRows(false);
            onCheckChange();
        }

        function togglePause() {
            autoRefresh = !autoRefresh;
            const btn = document.getElementById('pauseBtn');
            btn.textContent = autoRefresh ? '暂停刷新' : '继续刷新';
            btn.classList.toggle('on', !autoRefresh);
            scheduleRefresh();
        }

        function desiredRefreshInterval() {
            const n = currentRecords.length;
            if (n > 3000) return 12000;
            if (n > 800) return 8000;
            return 5000;
        }

        function scheduleRefresh() {
            const ms = desiredRefreshInterval();
            if (refreshTimer && ms === refreshIntervalMs) return;
            refreshIntervalMs = ms;
            if (refreshTimer) clearInterval(refreshTimer);
            refreshTimer = setInterval(() => {
                if (autoRefresh && !document.hidden) loadRecords();
            }, refreshIntervalMs);
        }

        function parseFilename(contentDisposition, fallback) {
            if (!contentDisposition) return fallback;
            const quoted = contentDisposition.match(/filename="([^"]+)"/i);
            if (quoted && quoted[1]) return quoted[1];
            const plain = contentDisposition.match(/filename=([^;]+)/i);
            return plain && plain[1] ? plain[1].trim() : fallback;
        }

        function exportOptions() {
            return {
                threads: Number(document.getElementById('threads').value) || 1,
                loops: Number(document.getElementById('loops').value) || 1,
                rampTime: Number(document.getElementById('rampTime').value),
                correlateToken: document.getElementById('correlateToken').checked,
                correlateEdits
            };
        }

        async function downloadExport(apiPath, fallbackName, failPrefix) {
            const filtered = getFilteredRecords();
            let ids = getCheckedIds();

            if (filtered.length === 0) {
                alert('没有可导出的记录');
                return;
            }

            if (ids.length === 0) {
                if (!confirm(`未勾选记录，将导出当前筛选的 ${filtered.length} 条，是否继续？`)) {
                    return;
                }
                ids = filtered.map(r => r.id);
            }

            try {
                const res = await fetch(apiPath, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids, ...exportOptions() })
                });

                if (!res.ok) {
                    let detail = failPrefix;
                    try {
                        const data = await res.json();
                        detail = data.error || data.msg || detail;
                    } catch (e) {}
                    throw new Error(detail);
                }

                const filename = parseFilename(res.headers.get('content-disposition'), fallbackName);
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } catch (e) {
                alert(e.message || failPrefix);
            }
        }

        function exportJMX() {
            downloadExport('./api/export', `whistle_script_${Date.now()}.jmx`, '导出 JMX 失败');
        }

        function exportPostman() {
            downloadExport('./api/export-postman', `whistle_postman_${Date.now()}.json`, '导出 Postman 失败');
        }

        function exportK6() {
            downloadExport('./api/export-k6', `whistle_k6_${Date.now()}.js`, '导出 k6 失败');
        }

        function exportCSV() {
            downloadExport('./api/export-csv', `whistle_traffic_${Date.now()}.csv`, '导出 CSV 失败');
        }