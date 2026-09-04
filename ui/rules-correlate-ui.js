'use strict';
// Rules + correlate preview UI

        const CORRELATE_KIND_PRIORITY = {
            token: 10,
            refreshToken: 20,
            csrf: 30,
            cursor: 40,
            manual: 50,
            header: 60,
            location: 70,
            form: 80,
            xml: 90,
            id: 100
        };

        function setRulesStatus(text) {
            document.getElementById('rulesStatus').textContent = text || '';
        }

        function openRulesModal() {
            const modal = document.getElementById('rulesModal');
            modal.hidden = false;
            setRulesStatus('');
            loadPluginRules().then(() => {
                const ta = document.getElementById('pluginRules');
                if (ta) {
                    ta.focus();
                    ta.setSelectionRange(ta.value.length, ta.value.length);
                }
            });
        }

        function closeRulesModal() {
            document.getElementById('rulesModal').hidden = true;
        }

        async function loadPluginRules() {
            try {
                const res = await fetch('./api/rules');
                const result = await res.json();
                if (result && result.data && typeof result.data.text === 'string') {
                    document.getElementById('pluginRules').value = result.data.text;
                }
            } catch (e) {
                setRulesStatus('读取规则失败');
            }
        }

        async function postPluginRules(payload, okText) {
            try {
                const res = await fetch('./api/rules', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) {
                    throw new Error((result && result.msg) || '保存失败');
                }
                if (result.data && typeof result.data.text === 'string') {
                    document.getElementById('pluginRules').value = result.data.text;
                }
                if (result.data && result.data.packaged === false) {
                    setRulesStatus('已保存到数据目录，但未能写入 rules.txt，Whistle 可能不会立即生效');
                } else {
                    setRulesStatus(okText || '已保存，Whistle 将在数秒内重新加载规则');
                }
            } catch (e) {
                setRulesStatus(e.message || '保存失败');
                alert(e.message || '保存规则失败');
            }
        }

        function savePluginRules() {
            return postPluginRules({ text: document.getElementById('pluginRules').value }, '已保存，Whistle 将在数秒内重新加载规则');
        }

        function resetPluginRules() {
            if (!confirm('恢复为默认规则 * whistle.jmeter-exporter:// ？')) return;
            return postPluginRules({ reset: true }, '已恢复默认规则');
        }

        function resolveExportIds() {
            const filtered = getFilteredRecords();
            let ids = getCheckedIds();
            if (filtered.length === 0) return [];
            if (ids.length === 0) ids = filtered.map(r => r.id);
            return ids;
        }

        function collectCorrelateEditsFromTable() {
            const disabled = [];
            const rename = {};
            const jsonPath = {};
            const regex = {};
            document.querySelectorAll('#correlateBody tr[data-id]').forEach((row) => {
                const id = row.getAttribute('data-id');
                const enabled = row.querySelector('.corr-on').checked;
                const name = row.querySelector('.corr-name').value.trim();
                const expr = row.querySelector('.corr-expr').value.trim();
                const type = row.getAttribute('data-type') || 'json';
                if (!enabled) disabled.push(id);
                if (name) rename[id] = name;
                if (type === 'json') jsonPath[id] = expr;
                else regex[id] = expr;
            });
            correlateEdits = { disabled, rename, jsonPath, regex };
            return correlateEdits;
        }

        function kindLabel(kind) {
            const map = {
                token: 'Token',
                refreshToken: 'Refresh',
                cursor: '游标',
                csrf: 'CSRF',
                header: '响应头',
                location: 'Location',
                form: '表单',
                xml: 'XML',
                manual: '后置提取',
                id: '业务ID'
            };
            return map[kind] || kind || 'ID';
        }

        function correlateKindPriority(kind) {
            return CORRELATE_KIND_PRIORITY[kind] || 110;
        }

        function isCorrelateRowEnabled(item) {
            const disabled = new Set(correlateEdits.disabled || []);
            return !disabled.has(item.id);
        }

        function getCorrelateFilterState() {
            const searchEl = document.getElementById('correlateSearch');
            const kindEl = document.getElementById('correlateKindFilter');
            const sortEl = document.getElementById('correlateSort');
            const hideEl = document.getElementById('correlateHideDisabled');
            return {
                search: (searchEl && searchEl.value || '').trim().toLowerCase(),
                kind: (kindEl && kindEl.value) || 'all',
                sort: (sortEl && sortEl.value) || 'priority',
                hideDisabled: Boolean(hideEl && hideEl.checked)
            };
        }

        function sortCorrelateVars(vars, sortKey) {
            const list = vars.slice();
            list.sort((a, b) => {
                if (sortKey === 'name') {
                    const an = (correlateEdits.rename[a.id] || a.varName || '').toLowerCase();
                    const bn = (correlateEdits.rename[b.id] || b.varName || '').toLowerCase();
                    return an.localeCompare(bn);
                }
                if (sortKey === 'source') {
                    return (a.sourceIndex - b.sourceIndex)
                        || String(a.varName || '').localeCompare(String(b.varName || ''));
                }
                if (sortKey === 'uses') {
                    const au = (a.uses || []).length;
                    const bu = (b.uses || []).length;
                    return bu - au || correlateKindPriority(a.kind) - correlateKindPriority(b.kind);
                }
                return correlateKindPriority(a.kind) - correlateKindPriority(b.kind)
                    || (b.uses || []).length - (a.uses || []).length
                    || (a.sourceIndex - b.sourceIndex);
            });
            return list;
        }

        function filterCorrelateVars(vars) {
            const state = getCorrelateFilterState();
            return sortCorrelateVars(vars.filter((item) => {
                if (state.kind !== 'all' && item.kind !== state.kind) return false;
                if (state.hideDisabled && !isCorrelateRowEnabled(item)) return false;
                if (!state.search) return true;
                const hay = [
                    item.varName,
                    correlateEdits.rename[item.id],
                    item.sourceUrl,
                    item.sourceKey,
                    item.value
                ].filter(Boolean).join(' ').toLowerCase();
                return hay.indexOf(state.search) >= 0;
            }), state.sort);
        }

        function updateCorrelateSummary() {
            const vars = correlatePreview.vars || [];
            const enabled = vars.filter((item) => isCorrelateRowEnabled(item)).length;
            const filtered = filterCorrelateVars(vars);
            const shown = filtered.length;
            const tokenCount = vars.filter((item) => item.kind === 'token' && isCorrelateRowEnabled(item)).length;
            const noUse = vars.filter((item) => isCorrelateRowEnabled(item) && !(item.uses || []).length).length;
            const el = document.getElementById('correlateSummary');
            if (!el) return;
            let text = `已启用 ${enabled} / 共 ${vars.length}`;
            if (shown !== vars.length) text += ` · 显示 ${shown}`;
            if (tokenCount) text += ` · Token ${tokenCount}`;
            if (noUse) text += ` · ${noUse} 项无下游引用`;
            el.textContent = text;
        }

        function onCorrelateFilterChange() {
            collectCorrelateEditsFromTable();
            renderCorrelateTable(false);
        }

        function bulkCorrelateToggle(mode) {
            collectCorrelateEditsFromTable();
            const vars = correlatePreview.vars || [];
            if (mode === 'all') {
                correlateEdits.disabled = [];
            } else if (mode === 'none') {
                correlateEdits.disabled = vars.map((item) => item.id);
            } else if (mode === 'token') {
                correlateEdits.disabled = vars
                    .filter((item) => item.kind !== 'token')
                    .map((item) => item.id);
            }
            renderCorrelateTable(false);
            document.getElementById('correlateStatus').textContent = '已更新勾选，导出 JMX 时生效';
        }

        function renderCorrelateTable(collectFirst) {
            if (collectFirst !== false) collectCorrelateEditsFromTable();
            const tbody = document.getElementById('correlateBody');
            const vars = correlatePreview.vars || [];
            if (!vars.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">未发现可关联参数。勾选或筛选记录后再试。</td></tr>';
                updateCorrelateSummary();
                return;
            }
            const disabled = new Set(correlateEdits.disabled || []);
            const rows = filterCorrelateVars(vars);
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">当前筛选条件下无匹配项。</td></tr>';
                updateCorrelateSummary();
                return;
            }
            tbody.innerHTML = rows.map((item) => {
                const id = escapeHtml(item.id);
                const enabled = !disabled.has(item.id);
                const checked = enabled ? ' checked' : '';
                const name = escapeHtml(correlateEdits.rename[item.id] || item.varName);
                const expr = escapeHtml(
                    correlateEdits.jsonPath[item.id]
                    || correlateEdits.regex[item.id]
                    || item.jsonPath
                    || item.regex
                    || ''
                );
                const source = `${item.sourceIndex + 1}. ${item.sourceMethod || ''} ${item.sourceUrl || ''}`;
                const uses = (item.uses || []).map((use) =>
                    `${use.index + 1}.${use.method} ${(use.fields || []).join(', ')}`
                ).join('<br>') || '— 无下游引用 —';
                const valueHint = item.value
                    ? `<div class="hint" title="${escapeHtml(item.value)}">值: ${escapeHtml(String(item.value).slice(0, 24))}${String(item.value).length > 24 ? '…' : ''}</div>`
                    : '';
                const kindClass = escapeHtml(item.kind || 'id');
                const rowClass = !enabled
                    ? 'corr-row-off'
                    : ((item.uses || []).length ? '' : 'corr-row-warn');
                return `<tr class="${rowClass}" data-id="${id}" data-type="${escapeHtml(item.type || 'json')}">
                    <td><input type="checkbox" class="corr-on"${checked} onchange="onCorrelateRowToggle()"></td>
                    <td><input type="text" class="corr-name" value="${name}" title="${escapeHtml(item.varName || '')}">${valueHint}</td>
                    <td><span class="kind-tag ${kindClass}">${escapeHtml(kindLabel(item.kind))}</span></td>
                    <td><div title="${escapeHtml(source)}">${escapeHtml(source)}</div><div class="hint">${uses}</div></td>
                    <td><input type="text" class="corr-expr" value="${expr}"></td>
                </tr>`;
            }).join('');
            updateCorrelateSummary();
        }

        function onCorrelateRowToggle() {
            collectCorrelateEditsFromTable();
            updateCorrelateSummary();
        }

        async function openCorrelateModal() {
            const ids = resolveExportIds();
            if (ids.length === 0) {
                alert('没有可分析的记录');
                return;
            }
            document.getElementById('correlateModal').hidden = false;
            document.getElementById('correlateStatus').textContent = '分析中...';
            const searchEl = document.getElementById('correlateSearch');
            const kindEl = document.getElementById('correlateKindFilter');
            const sortEl = document.getElementById('correlateSort');
            const hideEl = document.getElementById('correlateHideDisabled');
            if (searchEl) searchEl.value = '';
            if (kindEl) kindEl.value = 'all';
            if (sortEl) sortEl.value = 'priority';
            if (hideEl) hideEl.checked = false;
            try {
                const res = await fetch('./api/correlate-preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '预览失败');
                correlatePreview = result.data || { vars: [], jwtClaims: [] };
                renderCorrelateTable(false);
                const jwt = correlatePreview.jwtClaims || [];
                const note = document.getElementById('correlateJwtNote');
                if (jwt.length) {
                    note.hidden = false;
                    note.textContent = '检测到 JWT 声明（' + jwt.map((item) => item.key).join(', ') + '）在后续请求中出现，JMeter 需自行解码 JWT，未自动生成提取器。';
                } else {
                    note.hidden = true;
                    note.textContent = '';
                }
                const enabled = (correlatePreview.vars || []).filter((item) => isCorrelateRowEnabled(item)).length;
                document.getElementById('correlateStatus').textContent =
                    `发现 ${correlatePreview.vars.length} 个关联项，默认启用 ${enabled} 个`;
            } catch (e) {
                document.getElementById('correlateStatus').textContent = e.message || '预览失败';
            }
        }

        function closeCorrelateModal() {
            document.getElementById('correlateModal').hidden = true;
        }

        function applyCorrelateEdits() {
            collectCorrelateEditsFromTable();
            document.getElementById('correlateStatus').textContent = '已保存，导出 JMX 时生效';
            updateCorrelateSummary();
        }

        function downloadCorrelateReport() {
            collectCorrelateEditsFromTable();
            const blob = new Blob([JSON.stringify({
                generatedAt: new Date().toISOString(),
                edits: correlateEdits,
                ...correlatePreview
            }, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `correlate_report_${Date.now()}.json`;
            a.click();
            window.URL.revokeObjectURL(url);
        }
