'use strict';
// Post-ops UI (extract, assert, db) — extracted from index.html

        let editingDbConnId = '';
        let savingDbConn = false;

        async function openExtractModal() {
            closePostOpMenu();
            if (!selectedId || !selectedRecord) {
                alert('请先点击一条捕获记录');
                return;
            }
            editingExtractId = '';
            activeSourceTreeId = 'jpTree';
            document.getElementById('extractModal').hidden = false;
            clearExtractFieldErrors();
            const status = document.getElementById('extractStatus');
            status.textContent = '';
            status.classList.remove('is-error', 'is-ok');
            document.getElementById('extractVarName').value = '';
            document.getElementById('extractVarName').dataset.auto = '1';
            document.getElementById('extractSource').value = 'json';
            document.querySelector('input[name="extractMethod"][value="jsonpath"]').checked = true;
            document.getElementById('extractJsonPath').value = '';
            document.getElementById('extractHeaderName').value = '';
            document.getElementById('extractUnpack').checked = false;
            onExtractSourceChange();
            try {
                await loadExtractItems();
            } catch (e) {
                document.getElementById('extractStatus').textContent = '读取已保存提取失败';
            }
            scheduleExtractPreview();
        }

        function closeExtractModal() {
            document.getElementById('extractModal').hidden = true;
            editingExtractId = '';
        }

        function editExtractItem(id) {
            const item = extractItems.find((row) => row.id === id);
            if (!item) return;
            editingExtractId = item.id;
            document.getElementById('extractVarName').value = item.varName || '';
            document.getElementById('extractVarName').dataset.auto = '0';
            document.getElementById('extractSource').value = item.source || 'json';
            document.querySelector('input[name="extractMethod"][value="' + (item.method === 'whole' ? 'whole' : 'jsonpath') + '"]').checked = true;
            document.getElementById('extractJsonPath').value = item.jsonPath || '$';
            document.getElementById('extractHeaderName').value = item.headerName || '';
            document.getElementById('extractUnpack').checked = Boolean(item.arrayUnpack);
            onExtractSourceChange();
            document.getElementById('extractStatus').textContent = '正在编辑 ' + item.varName;
        }

        async function deleteExtractItem(id) {
            const next = extractItems.filter((item) => item.id !== id);
            await persistExtractItems(next, '已删除');
        }

        function sameExtract(a, b) {
            if (!a || !b) return false;
            if (String(a.varName || '').toLowerCase() === String(b.varName || '').toLowerCase()) return true;
            if ((a.source || 'json') !== (b.source || 'json')) return false;
            if (a.source === 'header') {
                return String(a.headerName || '').toLowerCase() === String(b.headerName || '').toLowerCase();
            }
            if (a.source === 'text') return true;
            return String(a.jsonPath || '$') === String(b.jsonPath || '$')
                && Boolean(a.arrayUnpack) === Boolean(b.arrayUnpack)
                && (a.method || 'jsonpath') === (b.method || 'jsonpath');
        }

        async function persistExtractItems(items, okText) {
            try {
                const res = await fetch('./api/extract-vars', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordId: selectedId, items })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                extractItems = (result.data && result.data.items) || [];
                renderExtractList();
                refreshPostOpBadge();
                clearExtractFieldErrors();
                const status = document.getElementById('extractStatus');
                status.classList.remove('is-error');
                status.classList.add('is-ok');
                status.textContent = formatPostOpSave(okText, result);
            } catch (e) {
                const status = document.getElementById('extractStatus');
                status.classList.remove('is-ok');
                status.classList.add('is-error');
                status.textContent = e.message || '保存失败';
            }
        }

        const ASSERT_OP_LABELS = {
            equals: '等于',
            not_equals: '不等于',
            contains: '包含',
            not_contains: '不包含',
            exists: '存在',
            not_exists: '不存在',
            regex: '正则匹配'
        };

        function onAssertSourceChange() {
            syncAssertSourceView();
            scheduleAssertPreview();
        }

        function onAssertOperatorChange() {
            const op = document.getElementById('assertOperator').value;
            const hideExpected = op === 'exists' || op === 'not_exists';
            document.getElementById('assertExpected').hidden = hideExpected;
            scheduleAssertPreview();
        }

        function syncAssertSourceView() {
            const source = document.getElementById('assertSource').value;
            activeSourceTreeId = 'assertJpTree';
            document.getElementById('assertHeaderWrap').hidden = source !== 'header';
            document.getElementById('assertJsonFields').hidden = source !== 'json';
            document.getElementById('assertJpTool').hidden = false;
            const left = document.getElementById('assertLeftTitle');
            const hint = document.getElementById('assertHint');
            if (source === 'header') {
                left.textContent = 'Response Headers';
                hint.textContent = '悬停响应头并点击「提取响应头」填写名称';
                fillExtractHeaders();
            } else if (source === 'text') {
                left.textContent = 'Response Text';
                hint.textContent = '对完整响应正文做断言';
                fillExtractText();
            } else if (source === 'status') {
                left.textContent = 'HTTP Code';
                hint.textContent = '对响应状态码做断言';
                const code = selectedRecord && selectedRecord.responseStatus != null ? String(selectedRecord.responseStatus) : '';
                document.getElementById('assertJpTree').innerHTML = code
                    ? '<div class="jp-node"><span class="jp-num">' + escapeHtml(code) + '</span></div>'
                    : '<p class="hint">没有状态码</p>';
                if (code && !document.getElementById('assertExpected').value) {
                    document.getElementById('assertExpected').value = code;
                }
            } else {
                left.textContent = 'JSON';
                hint.textContent = '悬停字段并点击「提取 JSONPath」填写表达式';
                fillExtractJsonTree();
            }
            onAssertOperatorChange();
        }

        function applyAssertPath(path) {
            const expr = String(path || '').trim();
            if (!expr) return;
            document.getElementById('assertSource').value = 'json';
            document.getElementById('assertJsonPath').value = expr;
            const name = document.getElementById('assertName');
            if (!name.value) name.value = lastJsonPathKey(expr);
            syncAssertSourceView();
            document.getElementById('assertJsonPath').focus();
            scheduleAssertPreview();
        }

        function applyAssertHeader(name) {
            const header = String(name || '').trim();
            if (!header) return;
            document.getElementById('assertSource').value = 'header';
            document.getElementById('assertHeaderName').value = header;
            const nameInput = document.getElementById('assertName');
            if (!nameInput.value) nameInput.value = header;
            document.getElementById('assertHeaderName').focus();
            scheduleAssertPreview();
        }

        function scheduleAssertPreview() {
            clearTimeout(assertPreviewTimer);
            assertPreviewTimer = setTimeout(runAssertPreview, 180);
        }

        function collectAssertForm() {
            return {
                id: editingAssertId || undefined,
                name: document.getElementById('assertName').value.trim(),
                source: document.getElementById('assertSource').value,
                jsonPath: document.getElementById('assertJsonPath').value.trim() || '$',
                headerName: document.getElementById('assertHeaderName').value.trim(),
                arrayUnpack: document.getElementById('assertUnpack').checked,
                operator: document.getElementById('assertOperator').value,
                expected: document.getElementById('assertExpected').value
            };
        }

        async function runAssertPreview() {
            const out = document.getElementById('assertResult');
            if (!selectedId) {
                out.textContent = '请先选择一条记录';
                out.className = 'jp-result';
                return;
            }
            const payload = collectAssertForm();
            try {
                const res = await fetch('./api/assertions/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(withRecordSnapshot(payload))
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '预览失败');
                const data = result.data || {};
                if (data.error && !data.ok) {
                    out.className = 'jp-result fail';
                    out.textContent = data.error;
                    return;
                }
                const expectedLine = payload.operator === 'exists' || payload.operator === 'not_exists'
                    ? ''
                    : '\n期望: ' + (data.expected || '');
                out.className = 'jp-result ' + (data.passed ? 'pass' : 'fail');
                out.textContent = (data.passed ? '通过' : '失败') + '\n实际: ' + (data.actual || '') + expectedLine;
                if (!payload.expected && data.actual && (payload.operator === 'equals' || payload.operator === 'contains')) {
                    document.getElementById('assertExpected').value = data.actual;
                }
            } catch (e) {
                out.className = 'jp-result fail';
                out.textContent = e.message || '预览失败';
            }
        }

        function assertSourceLabel(source) {
            if (source === 'header') return 'Header';
            if (source === 'text') return 'Text';
            if (source === 'status') return 'HTTP Code';
            return 'JSON';
        }

        function sameAssert(a, b) {
            if (!a || !b) return false;
            return (a.source || 'json') === (b.source || 'json')
                && String(a.jsonPath || '$') === String(b.jsonPath || '$')
                && String(a.headerName || '').toLowerCase() === String(b.headerName || '').toLowerCase()
                && (a.operator || 'equals') === (b.operator || 'equals')
                && String(a.expected || '') === String(b.expected || '')
                && Boolean(a.arrayUnpack) === Boolean(b.arrayUnpack);
        }

        function renderAssertList() {
            const tbody = document.getElementById('assertListBody');
            if (!assertItems.length) {
                tbody.innerHTML = '<tr><td colspan="4" class="empty-state">尚未添加</td></tr>';
                return;
            }
            tbody.innerHTML = assertItems.map((item) => {
                const cond = (ASSERT_OP_LABELS[item.operator] || item.operator) +
                    (item.operator === 'exists' || item.operator === 'not_exists' ? '' : (' ' + (item.expected || '')));
                const expr = item.source === 'json' ? (item.jsonPath || '$') : (item.source === 'header' ? (item.headerName || '') : '');
                return '<tr>' +
                    '<td>' + escapeHtml(item.name || expr || '断言') + '</td>' +
                    '<td>' + escapeHtml(assertSourceLabel(item.source)) + '</td>' +
                    '<td>' + escapeHtml(cond) + (expr && item.source === 'json' ? '<div class="hint">' + escapeHtml(expr) + '</div>' : '') + '</td>' +
                    '<td><button type="button" onclick="editAssertItem(\'' + escapeHtml(item.id) + '\')">编辑</button> ' +
                    '<button type="button" onclick="deleteAssertItem(\'' + escapeHtml(item.id) + '\')">删除</button></td>' +
                    '</tr>';
            }).join('');
        }

        async function loadAssertItems() {
            if (!selectedId) return;
            const res = await fetch('./api/assertions?recordId=' + encodeURIComponent(selectedId));
            const result = await res.json();
            assertItems = (result.data && result.data.items) || [];
            renderAssertList();
            refreshPostOpBadge();
        }

        async function openAssertModal() {
            closePostOpMenu();
            if (!selectedId || !selectedRecord) {
                alert('请先点击一条捕获记录');
                return;
            }
            editingAssertId = '';
            activeSourceTreeId = 'assertJpTree';
            document.getElementById('assertModal').hidden = false;
            document.getElementById('assertStatus').textContent = '';
            document.getElementById('assertName').value = '';
            document.getElementById('assertSource').value = 'json';
            document.getElementById('assertJsonPath').value = '$';
            document.getElementById('assertHeaderName').value = '';
            document.getElementById('assertUnpack').checked = false;
            document.getElementById('assertOperator').value = 'equals';
            document.getElementById('assertExpected').value = '';
            document.getElementById('assertExpected').hidden = false;
            syncAssertSourceView();
            try {
                await loadAssertItems();
            } catch (e) {
                document.getElementById('assertStatus').textContent = '读取已保存断言失败';
            }
            scheduleAssertPreview();
        }

        function closeAssertModal() {
            document.getElementById('assertModal').hidden = true;
            editingAssertId = '';
            activeSourceTreeId = 'jpTree';
        }

        function editAssertItem(id) {
            const item = assertItems.find((row) => row.id === id);
            if (!item) return;
            editingAssertId = item.id;
            document.getElementById('assertName').value = item.name || '';
            document.getElementById('assertSource').value = item.source || 'json';
            document.getElementById('assertJsonPath').value = item.jsonPath || '$';
            document.getElementById('assertHeaderName').value = item.headerName || '';
            document.getElementById('assertUnpack').checked = Boolean(item.arrayUnpack);
            document.getElementById('assertOperator').value = item.operator || 'equals';
            document.getElementById('assertExpected').value = item.expected || '';
            syncAssertSourceView();
            document.getElementById('assertStatus').textContent = '正在编辑 ' + (item.name || '断言');
            scheduleAssertPreview();
        }

        async function deleteAssertItem(id) {
            const next = assertItems.filter((item) => item.id !== id);
            await persistAssertItems(next, '已删除');
        }

        async function saveAssertItem() {
            const form = collectAssertForm();
            if (form.source === 'json' && !form.jsonPath) {
                document.getElementById('assertStatus').textContent = '请填写 JSONPath';
                return;
            }
            if (form.source === 'header' && !form.headerName) {
                document.getElementById('assertStatus').textContent = '请填写响应头名称';
                return;
            }
            if ((form.operator === 'equals' || form.operator === 'contains' || form.operator === 'regex' || form.operator === 'not_equals' || form.operator === 'not_contains') && !form.expected && form.source !== 'status') {
                document.getElementById('assertStatus').textContent = '请填写期望值';
                return;
            }
            const next = assertItems.slice();
            let idx = -1;
            if (editingAssertId) idx = next.findIndex((item) => item.id === editingAssertId);
            if (idx < 0) idx = next.findIndex((item) => sameAssert(item, form));
            const updating = idx >= 0;
            if (updating) next[idx] = Object.assign({}, next[idx], form, { id: next[idx].id });
            else next.push(form);
            await persistAssertItems(next, updating ? '已更新，未新增重复项' : '已保存，导出 JMX 时生效');
            const saved = assertItems.find((item) => sameAssert(item, form)) || assertItems[assertItems.length - 1];
            editingAssertId = saved && saved.id ? saved.id : '';
        }

        async function persistAssertItems(items, okText) {
            try {
                const res = await fetch('./api/assertions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordId: selectedId, items })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                assertItems = (result.data && result.data.items) || [];
                renderAssertList();
                refreshPostOpBadge();
                document.getElementById('assertStatus').textContent = formatPostOpSave(okText, result);
            } catch (e) {
                document.getElementById('assertStatus').textContent = e.message || '保存失败';
            }
        }

        const DB_TYPE_PORTS = { mysql: 3306, postgres: 5432, sqlserver: 1433, mongodb: 27017 };
        const DB_TYPE_LABELS = { mysql: 'MySQL', postgres: 'PostgreSQL', sqlserver: 'SQL Server', mongodb: 'MongoDB' };

        function closeDbDynMenu() {
            const menu = document.getElementById('dbDynMenu');
            if (menu) menu.hidden = true;
        }

        function insertAtCursor(textarea, text) {
            if (!textarea) return;
            const start = textarea.selectionStart == null ? textarea.value.length : textarea.selectionStart;
            const end = textarea.selectionEnd == null ? start : textarea.selectionEnd;
            textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
            const pos = start + text.length;
            textarea.selectionStart = textarea.selectionEnd = pos;
            textarea.focus();
        }

        async function toggleDbDynMenu(event) {
            event.stopPropagation();
            const menu = document.getElementById('dbDynMenu');
            if (!menu) return;
            if (!menu.hidden) {
                menu.hidden = true;
                return;
            }
            const names = [];
            (extractItems || []).forEach((item) => {
                if (item.varName && names.indexOf(item.varName) < 0) names.push(item.varName);
            });
            syncDbExtractRowsFromDom();
            dbExtractRows.forEach((row) => {
                if (row.varName && names.indexOf(row.varName) < 0) names.push(row.varName);
            });
            ['username', 'token', 'id'].forEach((name) => {
                if (names.indexOf(name) < 0) names.push(name);
            });
            try {
                const res = await fetch('./api/extract-vars?recordId=' + encodeURIComponent(selectedId));
                const result = await res.json();
                ((result.data && result.data.items) || []).forEach((item) => {
                    if (item.varName && names.indexOf(item.varName) < 0) names.push(item.varName);
                });
            } catch (e) {
                // ignore
            }
            menu.innerHTML = names.map((name) =>
                '<button type="button" onclick="insertDbDynamic(\'' + escapeHtml(name) + '\')">{{' + escapeHtml(name) + '}}</button>'
            ).join('') || '<div class="menu-label">暂无变量</div>';
            menu.hidden = false;
        }

        function insertDbDynamic(name) {
            insertAtCursor(document.getElementById('dbSql'), '{{' + name + '}}');
            closeDbDynMenu();
        }

        function syncDbExtractRowsFromDom() {
            const body = document.getElementById('dbExtractBody');
            if (!body) return;
            const next = [];
            body.querySelectorAll('tr[data-idx]').forEach((tr) => {
                next.push({
                    id: tr.getAttribute('data-id') || '',
                    varName: ((tr.querySelector('.db-ex-name') || {}).value || '').trim(),
                    jsonPath: ((tr.querySelector('.db-ex-path') || {}).value || '').trim()
                });
            });
            dbExtractRows = next;
        }

        function renderDbExtractRows() {
            const body = document.getElementById('dbExtractBody');
            if (!body) return;
            if (!dbExtractRows.length) {
                body.innerHTML = '<tr><td colspan="4" class="empty-state">尚未添加</td></tr>';
                scheduleDbExtractPreview();
                return;
            }
            if (activeDbExtractIdx < 0 || activeDbExtractIdx >= dbExtractRows.length) {
                activeDbExtractIdx = 0;
            }
            body.innerHTML = dbExtractRows.map((row, i) =>
                '<tr data-idx="' + i + '" data-id="' + escapeHtml(row.id || '') + '">' +
                '<td><input class="db-ex-name" placeholder="userId" value="' + escapeHtml(row.varName || '') + '"></td>' +
                '<td><select disabled><option>String</option></select></td>' +
                '<td><input class="db-ex-path" placeholder="$[0].id" value="' + escapeHtml(row.jsonPath || '') + '"></td>' +
                '<td><button type="button" onclick="removeDbExtractRow(' + i + ')">删除</button></td>' +
                '</tr>'
            ).join('');
            bindDbExtractRowEvents();
        }

        function bindDbExtractRowEvents() {
            const body = document.getElementById('dbExtractBody');
            if (!body) return;
            body.querySelectorAll('tr[data-idx]').forEach((tr) => {
                const idx = Number(tr.getAttribute('data-idx'));
                tr.onclick = function (event) {
                    if (event.target.closest('button')) return;
                    activeDbExtractIdx = idx;
                    highlightDbExtractRow();
                    scheduleDbExtractPreview();
                };
                const pathInput = tr.querySelector('.db-ex-path');
                const nameInput = tr.querySelector('.db-ex-name');
                if (pathInput) {
                    pathInput.oninput = function () {
                        activeDbExtractIdx = idx;
                        syncDbExtractRowsFromDom();
                        const name = tr.querySelector('.db-ex-name');
                        if (name && pathInput.value.trim() && !name.value.trim()) {
                            name.value = lastJsonPathKey(pathInput.value.trim());
                        }
                        scheduleDbExtractPreview();
                    };
                }
                if (nameInput) {
                    nameInput.oninput = function () {
                        activeDbExtractIdx = idx;
                        syncDbExtractRowsFromDom();
                    };
                }
            });
            highlightDbExtractRow();
        }

        function highlightDbExtractRow() {
            document.querySelectorAll('#dbExtractBody tr[data-idx]').forEach((tr) => {
                tr.classList.toggle('db-ex-active', Number(tr.getAttribute('data-idx')) === activeDbExtractIdx);
            });
        }

        function bindDbExtractTreeClicks() {
            const tree = document.getElementById('dbJpTree');
            if (!tree) return;
            tree.onclick = function (event) {
                const btn = event.target && event.target.closest && event.target.closest('.jp-extract');
                if (!btn) return;
                event.preventDefault();
                applyDbExtractPath(btn.getAttribute('data-path'));
            };
        }

        function fillDbJsonTree() {
            activeSourceTreeId = 'dbJpTree';
            const tree = document.getElementById('dbJpTree');
            if (!tree) return;
            jpNodeCount = 0;
            if (!Array.isArray(dbSqlResultData)) {
                tree.innerHTML = '<p class="hint">请先点击「执行」获取 SQL 结果。</p>';
                bindDbExtractTreeClicks();
                return;
            }
            if (!dbSqlResultData.length) {
                tree.innerHTML = '<p class="hint">查询结果为空数组 []。</p>';
                bindDbExtractTreeClicks();
                return;
            }
            try {
                tree.innerHTML = renderJsonTree(dbSqlResultData, []);
            } catch (e) {
                tree.innerHTML = '<p class="hint">结果无法渲染为 JSON 树。</p>';
            }
            bindDbExtractTreeClicks();
        }

        function applyDbExtractPath(path) {
            const expr = String(path || '').trim();
            if (!expr) return;
            syncDbExtractRowsFromDom();
            if (!dbExtractRows.length) {
                dbExtractRows.push({ id: '', varName: lastJsonPathKey(expr), jsonPath: expr });
                activeDbExtractIdx = 0;
            } else {
                if (activeDbExtractIdx < 0 || activeDbExtractIdx >= dbExtractRows.length) {
                    activeDbExtractIdx = 0;
                }
                dbExtractRows[activeDbExtractIdx].jsonPath = expr;
                if (!dbExtractRows[activeDbExtractIdx].varName) {
                    dbExtractRows[activeDbExtractIdx].varName = lastJsonPathKey(expr);
                }
            }
            renderDbExtractRows();
            scheduleDbExtractPreview();
        }

        function previewDbExtractLocal(jsonPath) {
            if (!Array.isArray(dbSqlResultData)) return null;
            try {
                const value = walkSimpleJsonPath(dbSqlResultData, jsonPath || '$');
                if (value === undefined) return { ok: false, error: '未匹配到结果' };
                if (value !== null && typeof value === 'object') {
                    return { ok: true, preview: JSON.stringify(value, null, 2) };
                }
                return { ok: true, preview: String(value) };
            } catch (e) {
                return null;
            }
        }

        function scheduleDbExtractPreview() {
            clearTimeout(dbExtractPreviewTimer);
            dbExtractPreviewTimer = setTimeout(runDbExtractPreview, 180);
        }

        async function runDbExtractPreview() {
            const out = document.getElementById('dbExtractPreview');
            if (!out) return;
            syncDbExtractRowsFromDom();
            if (!Array.isArray(dbSqlResultData)) {
                out.className = 'jp-result';
                out.textContent = '请先执行 SQL 获取结果数组';
                return;
            }
            const row = dbExtractRows[activeDbExtractIdx];
            if (!row || !row.jsonPath) {
                out.className = 'jp-result';
                out.textContent = dbExtractRows.length ? '请填写 JSONPath 表达式' : '请先添加变量行';
                return;
            }
            const local = previewDbExtractLocal(row.jsonPath);
            if (local) {
                out.className = 'jp-result ' + (local.ok ? 'pass' : 'fail');
                out.textContent = local.ok ? (local.preview || '(empty)') : (local.error || '未匹配到结果');
            }
            try {
                const res = await fetch('./api/db-ops/extract-preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rows: dbSqlResultData, jsonPath: row.jsonPath })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '预览失败');
                const data = result.data || {};
                out.className = 'jp-result ' + (data.ok ? 'pass' : 'fail');
                out.textContent = data.ok ? (data.preview || '(empty)') : (data.error || '未匹配到结果');
                if (data.ok && data.preview && row.varName && !row.varName.trim()) {
                    dbExtractRows[activeDbExtractIdx].varName = lastJsonPathKey(row.jsonPath);
                    renderDbExtractRows();
                }
            } catch (e) {
                if (!local) {
                    out.className = 'jp-result fail';
                    out.textContent = e.message || '预览失败';
                }
            }
        }

        function addDbExtractRow() {
            syncDbExtractRowsFromDom();
            dbExtractRows.push({ id: '', varName: '', jsonPath: '$[0].id' });
            activeDbExtractIdx = dbExtractRows.length - 1;
            renderDbExtractRows();
            scheduleDbExtractPreview();
        }

        function removeDbExtractRow(index) {
            syncDbExtractRowsFromDom();
            dbExtractRows.splice(index, 1);
            if (activeDbExtractIdx >= dbExtractRows.length) {
                activeDbExtractIdx = Math.max(0, dbExtractRows.length - 1);
            }
            renderDbExtractRows();
            scheduleDbExtractPreview();
        }

        function connLabel(id) {
            const item = dbConnections.find((row) => row.id === id);
            return item ? item.name : (id || '-');
        }

        function renderDbConnSelect(selectedIdValue) {
            const select = document.getElementById('dbConnSelect');
            if (!select) return;
            const current = selectedIdValue || select.value || '';
            const sqlConnections = dbConnections.filter((item) => item.type !== 'mongodb');
            select.innerHTML = '<option value="">请选择</option>' + sqlConnections.map((item) =>
                '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</option>'
            ).join('');
            if (current) select.value = current;
        }

        function renderDbOpDatabaseSelect(items, selectedValue) {
            const select = document.getElementById('dbOpDatabase');
            if (!select) return;
            const list = Array.isArray(items) ? items : [];
            select.innerHTML = '<option value="">请选择</option>' + list.map((name) =>
                '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>'
            ).join('');
            if (selectedValue && list.indexOf(selectedValue) >= 0) select.value = selectedValue;
            else if (list.length === 1) select.value = list[0];
        }

        function clearDbSqlResult() {
            dbSqlResultData = null;
            fillDbJsonTree();
            scheduleDbExtractPreview();
        }

        function showDbSqlError(message) {
            const tree = document.getElementById('dbJpTree');
            if (tree) {
                tree.innerHTML = '<p class="hint" style="color:#c62828">' + escapeHtml(message || '执行失败') + '</p>';
            }
            const out = document.getElementById('dbExtractPreview');
            if (out) {
                out.className = 'jp-result fail';
                out.textContent = message || '执行失败';
            }
        }

        async function loadDbOpDatabases(connectionId, preferredDatabase) {
            const select = document.getElementById('dbOpDatabase');
            if (!select) return;
            if (!connectionId) {
                renderDbOpDatabaseSelect([], '');
                return;
            }
            const conn = dbConnections.find((item) => item.id === connectionId);
            if (conn && conn.type !== 'mysql') {
                renderDbOpDatabaseSelect(conn.database ? [conn.database] : [], conn.database || preferredDatabase || '');
                return;
            }
            select.innerHTML = '<option value="">加载中…</option>';
            try {
                const res = await fetch('./api/db-ops/databases?connectionId=' + encodeURIComponent(connectionId));
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '读取数据库失败');
                const data = result.data || {};
                const items = data.items || [];
                const selected = preferredDatabase || data.defaultDatabase || '';
                renderDbOpDatabaseSelect(items, selected);
            } catch (e) {
                renderDbOpDatabaseSelect(conn && conn.database ? [conn.database] : [], conn && conn.database ? conn.database : '');
                document.getElementById('dbOpStatus').textContent = e.message || '读取数据库失败';
            }
        }

        async function onDbOpConnChange() {
            clearDbSqlResult();
            const connectionId = document.getElementById('dbConnSelect').value;
            const conn = dbConnections.find((item) => item.id === connectionId);
            await loadDbOpDatabases(connectionId, conn && conn.database ? conn.database : '');
        }

        function toggleDbSqlHint(event) {
            if (event) event.stopPropagation();
            const el = document.getElementById('dbSqlResultHint');
            if (!el) return;
            const open = el.classList.toggle('expanded');
            el.title = open ? '点击收起' : '点击查看全部';
        }

        function collapseDbSqlHint() {
            const el = document.getElementById('dbSqlResultHint');
            if (!el) return;
            el.classList.remove('expanded');
            el.title = '点击查看全部';
        }

        async function executeDbSql() {
            const status = document.getElementById('dbOpStatus');
            const connectionId = document.getElementById('dbConnSelect').value;
            const database = document.getElementById('dbOpDatabase').value.trim();
            const sql = document.getElementById('dbSql').value.trim();
            clearDbSqlResult();
            if (!connectionId) {
                status.textContent = '请选择数据库连接';
                return;
            }
            if (!database) {
                status.textContent = '请选择数据库名称';
                return;
            }
            if (!sql) {
                status.textContent = '请填写 SQL 命令';
                return;
            }
            status.textContent = '正在执行 SQL…';
            try {
                const res = await fetch('./api/db-ops/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recordId: selectedId,
                        connectionId,
                        database,
                        sql
                    })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '执行失败');
                const data = result.data || {};
                const rows = Array.isArray(data.rows) ? data.rows : [];
                dbSqlResultData = rows;
                fillDbJsonTree();
                scheduleDbExtractPreview();
                status.textContent = result.msg || ('执行成功（' + rows.length + ' 行）');
            } catch (e) {
                dbSqlResultData = null;
                showDbSqlError(e.message || '执行失败');
                status.textContent = e.message || '执行失败';
            }
        }

        function renderDbOpList() {
            const body = document.getElementById('dbOpListBody');
            if (!body) return;
            if (!dbOpItems.length) {
                body.innerHTML = '<tr><td colspan="4" class="empty-state">尚未添加</td></tr>';
                return;
            }
            body.innerHTML = dbOpItems.map((item) => {
                const sql = String(item.sql || '').replace(/\s+/g, ' ').slice(0, 80);
                return '<tr>' +
                    '<td>' + escapeHtml(item.name || '未命名') + '</td>' +
                    '<td>' + escapeHtml(connLabel(item.connectionId)) + '</td>' +
                    '<td>' + escapeHtml(sql) + '</td>' +
                    '<td><button type="button" onclick="editDbOpItem(\'' + escapeHtml(item.id) + '\')">编辑</button> ' +
                    '<button type="button" onclick="deleteDbOpItem(\'' + escapeHtml(item.id) + '\')">删除</button></td>' +
                    '</tr>';
            }).join('');
        }

        function refreshPersistConnectionSelects(selectedId) {
            const storageModal = document.getElementById('storageModal');
            if (storageModal && !storageModal.hidden && typeof fillPersistRemoteSelect === 'function') {
                const engine = typeof currentPersistEngine === 'function'
                    ? currentPersistEngine()
                    : (captureSettings.persistEngine || 'sqlite');
                const fallback = engine === 'postgres'
                    ? captureSettings.postgresConnectionId
                    : captureSettings.mysqlConnectionId;
                fillPersistRemoteSelect(engine, selectedId || fallback);
            }
            if (typeof fillGsPersistMysqlSelect === 'function') {
                fillGsPersistMysqlSelect(selectedId || captureSettings.mysqlConnectionId);
            }
        }

        async function loadDbConnections() {
            const res = await fetch('./api/db-connections');
            const result = await res.json();
            dbConnections = (result.data && result.data.items) || [];
            renderDbConnSelect();
            renderDbConnList();
            refreshPersistConnectionSelects();
        }

        async function loadDbOpItems() {
            if (!selectedId) return;
            const res = await fetch('./api/db-ops?recordId=' + encodeURIComponent(selectedId));
            const result = await res.json();
            dbOpItems = (result.data && result.data.items) || [];
            renderDbOpList();
            refreshPostOpBadge();
        }

        function resetDbOpForm() {
            editingDbOpId = '';
            dbExtractRows = [];
            activeDbExtractIdx = 0;
            dbSqlResultData = null;
            document.getElementById('dbOpName').value = '';
            document.getElementById('dbConnSelect').value = '';
            document.getElementById('dbSql').value = '';
            renderDbOpDatabaseSelect([], '');
            clearDbSqlResult();
            renderDbExtractRows();
            fillDbJsonTree();
            collapseDbSqlHint();
        }

        async function openDbOpModal() {
            closePostOpMenu();
            if (!selectedId || !selectedRecord) {
                alert('请先点击一条捕获记录');
                return;
            }
            document.getElementById('dbOpModal').hidden = false;
            document.getElementById('dbOpStatus').textContent = '';
            resetDbOpForm();
            try {
                await loadDbConnections();
                await loadDbOpItems();
                fillDbJsonTree();
            } catch (e) {
                document.getElementById('dbOpStatus').textContent = '读取已保存操作失败';
            }
        }

        function closeDbOpModal() {
            document.getElementById('dbOpModal').hidden = true;
            closeDbDynMenu();
            collapseDbSqlHint();
            editingDbOpId = '';
        }

        function editDbOpItem(id) {
            const item = dbOpItems.find((row) => row.id === id);
            if (!item) return;
            editingDbOpId = item.id;
            document.getElementById('dbOpName').value = item.name || '';
            document.getElementById('dbConnSelect').value = item.connectionId || '';
            document.getElementById('dbSql').value = item.sql || '';
            clearDbSqlResult();
            const conn = dbConnections.find((row) => row.id === item.connectionId);
            loadDbOpDatabases(item.connectionId || '', conn && conn.database ? conn.database : '');
            dbExtractRows = (item.extracts || []).map((row) => ({
                id: row.id || '',
                varName: row.varName || '',
                jsonPath: row.jsonPath || '$[0].id'
            }));
            renderDbExtractRows();
            document.getElementById('dbOpStatus').textContent = '正在编辑 ' + (item.name || '未命名');
            scheduleDbExtractPreview();
        }

        async function deleteDbOpItem(id) {
            const next = dbOpItems.filter((item) => item.id !== id);
            await persistDbOpItems(next, '已删除');
            if (editingDbOpId === id) resetDbOpForm();
        }

        async function saveDbOpItem() {
            const name = document.getElementById('dbOpName').value.trim();
            const connectionId = document.getElementById('dbConnSelect').value;
            const sql = document.getElementById('dbSql').value.trim();
            if (!name) {
                document.getElementById('dbOpStatus').textContent = '请填写操作名称';
                return;
            }
            if (!connectionId) {
                document.getElementById('dbOpStatus').textContent = '请选择数据库连接';
                return;
            }
            if (!sql) {
                document.getElementById('dbOpStatus').textContent = '请填写 SQL 命令';
                return;
            }
            syncDbExtractRowsFromDom();
            const extracts = dbExtractRows.filter((row) => row.varName && row.jsonPath);
            const form = { name, connectionId, sql, extracts };
            const next = dbOpItems.slice();
            let idx = -1;
            if (editingDbOpId) idx = next.findIndex((item) => item.id === editingDbOpId);
            if (idx < 0) idx = next.findIndex((item) => item.connectionId === connectionId && item.sql === sql);
            const updating = idx >= 0;
            if (updating) {
                next[idx] = Object.assign({}, next[idx], form, { id: next[idx].id });
            } else {
                next.push(form);
            }
            await persistDbOpItems(next, updating ? '已更新，未新增重复项' : '已保存，导出 JMX 时生效');
            const saved = dbOpItems.find((item) => item.connectionId === connectionId && item.sql === sql) || dbOpItems[dbOpItems.length - 1];
            editingDbOpId = saved && saved.id ? saved.id : '';
        }

        async function persistDbOpItems(items, okText) {
            try {
                const res = await fetch('./api/db-ops', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordId: selectedId, items })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                dbOpItems = (result.data && result.data.items) || [];
                renderDbOpList();
                refreshPostOpBadge();
                document.getElementById('dbOpStatus').textContent = formatPostOpSave(okText, result);
            } catch (e) {
                document.getElementById('dbOpStatus').textContent = e.message || '保存失败';
            }
        }

        function renderDbConnList() {
            const body = document.getElementById('dbConnListBody');
            if (!body) return;
            const q = ((document.getElementById('dbConnSearch') || {}).value || '').trim().toLowerCase();
            const items = dbConnections.filter((item) => {
                if (!q) return true;
                const blob = [item.name, item.type, item.description, item.host, item.database, item.username].join(' ').toLowerCase();
                return blob.indexOf(q) >= 0;
            });
            if (!items.length) {
                body.innerHTML = '<tr><td colspan="4" class="empty-state">' + (dbConnections.length ? '无匹配连接' : '尚未添加') + '</td></tr>';
                return;
            }
            body.innerHTML = items.map((item) => {
                const detail = item.description || ((item.host || '') + ':' + (item.port || '') + (item.username ? '  ' + item.username : '') + (item.database ? ' / ' + item.database : ''));
                return '<tr onclick="openDbConnForm(\'' + escapeHtml(item.id) + '\')" style="cursor:pointer">' +
                    '<td>' + escapeHtml(item.name) + '</td>' +
                    '<td>' + escapeHtml(DB_TYPE_LABELS[item.type] || item.type) + '</td>' +
                    '<td class="conn-desc">' + escapeHtml(detail) + '</td>' +
                    '<td onclick="event.stopPropagation()">' +
                    '<div class="conn-more">' +
                    '<button type="button" onclick="toggleConnMore(event)">···</button>' +
                    '<div class="post-op-menu conn-more-menu" hidden>' +
                    '<button type="button" onclick="openDbConnForm(\'' + escapeHtml(item.id) + '\')">编辑</button>' +
                    '<button type="button" class="danger" onclick="deleteDbConnection(\'' + escapeHtml(item.id) + '\')">删除</button>' +
                    '</div></div></td></tr>';
            }).join('');
        }

        function toggleConnMore(event) {
            event.stopPropagation();
            const menu = event.currentTarget && event.currentTarget.nextElementSibling;
            const open = menu && !menu.hidden;
            closeConnMoreMenus();
            if (menu && !open) menu.hidden = false;
        }

        function closeConnMoreMenus() {
            document.querySelectorAll('.conn-more-menu').forEach((el) => { el.hidden = true; });
        }

        function onDbConnTypeChange() {
            const type = document.getElementById('dbConnType').value;
            const port = document.getElementById('dbConnPort');
            if (!port.value || Number(port.value) === 3306 || Number(port.value) === 5432 || Number(port.value) === 1433) {
                port.value = DB_TYPE_PORTS[type] || 3306;
            }
        }

        function resetDbConnForm() {
            editingDbConnId = '';
            document.getElementById('dbConnName').value = '';
            document.getElementById('dbConnDesc').value = '';
            document.getElementById('dbConnType').value = 'mysql';
            document.getElementById('dbConnHost').value = '127.0.0.1';
            document.getElementById('dbConnPort').value = '3306';
            document.getElementById('dbConnDatabase').value = '';
            document.getElementById('dbConnUser').value = '';
            document.getElementById('dbConnPassword').value = '';
            document.getElementById('dbConnPassword').placeholder = '密码';
            document.getElementById('dbConnFormStatus').textContent = '';
            document.getElementById('dbConnFormTitle').textContent = '新建数据库连接';
        }

        async function openDbConnModal() {
            const gs = document.getElementById('generalSettingsModal');
            if (gs && gs.hidden) {
                openGeneralSettingsModal();
            }
            if (typeof selectGeneralSettingsTab === 'function') {
                selectGeneralSettingsTab('dbconn');
            } else if (typeof refreshGeneralSettingsDbConn === 'function') {
                await refreshGeneralSettingsDbConn();
            }
        }

        function closeDbConnModal() {
            closeDbConnForm();
            closeConnMoreMenus();
        }

        function openDbConnForm(id) {
            closeConnMoreMenus();
            const form = document.getElementById('dbConnFormModal');
            if (!form) return;
            if (id) {
                const item = dbConnections.find((row) => row.id === id);
                if (!item) return;
                editingDbConnId = item.id;
                document.getElementById('dbConnFormTitle').textContent = '编辑数据库连接';
                document.getElementById('dbConnName').value = item.name || '';
                document.getElementById('dbConnDesc').value = item.description || '';
                document.getElementById('dbConnType').value = item.type || 'mysql';
                document.getElementById('dbConnHost').value = item.host || '';
                document.getElementById('dbConnPort').value = item.port || '';
                document.getElementById('dbConnDatabase').value = item.database || '';
                document.getElementById('dbConnUser').value = item.username || '';
                document.getElementById('dbConnPassword').value = '';
                document.getElementById('dbConnPassword').placeholder = item.hasPassword ? '已保存，留空不改' : '密码';
                document.getElementById('dbConnFormStatus').textContent = '';
            } else {
                resetDbConnForm();
                editingDbConnId = 'db' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            }
            form.hidden = false;
        }

        function closeDbConnForm() {
            const form = document.getElementById('dbConnFormModal');
            if (form) form.hidden = true;
            editingDbConnId = '';
        }

        async function deleteDbConnection(id) {
            closeConnMoreMenus();
            if (!confirm('删除该数据库连接？')) return;
            try {
                const res = await fetch('./api/db-connections/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '删除失败');
                if (editingDbConnId === id) closeDbConnForm();
                await loadDbConnections();
                document.getElementById('dbConnStatus').textContent = '已删除';
            } catch (e) {
                document.getElementById('dbConnStatus').textContent = e.message || '删除失败';
            }
        }

        async function testDbConnection() {
            const status = document.getElementById('dbConnFormStatus');
            const type = document.getElementById('dbConnType').value || 'mysql';
            const host = document.getElementById('dbConnHost').value.trim() || '127.0.0.1';
            const port = Number(document.getElementById('dbConnPort').value) || undefined;
            const username = document.getElementById('dbConnUser').value.trim();
            const password = document.getElementById('dbConnPassword').value;
            const database = document.getElementById('dbConnDatabase').value.trim();
            if (type === 'mysql' || type === 'mongodb') {
                status.textContent = '正在连接 ' + (DB_TYPE_LABELS[type] || type) + ' ' + host + (database ? '/' + database : '') + ' …';
            } else {
                status.textContent = '正在测试 ' + host + ':' + (port || '') + ' …';
            }
            try {
                const res = await fetch('./api/db-connections/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: editingDbConnId || '',
                        type,
                        host,
                        port,
                        username,
                        password,
                        database
                    })
                });
                const result = await res.json();
                status.textContent = result.msg || (result.code === 0 ? '连接成功' : '连接失败');
            } catch (e) {
                status.textContent = e.message || '测试失败';
            }
        }

        async function saveDbConnection() {
            if (savingDbConn) return;
            const name = document.getElementById('dbConnName').value.trim();
            if (!name) {
                document.getElementById('dbConnFormStatus').textContent = '请填写名称';
                return;
            }
            const host = document.getElementById('dbConnHost').value.trim();
            if (!host) {
                document.getElementById('dbConnFormStatus').textContent = '请填写数据库地址';
                return;
            }
            if (!editingDbConnId) {
                editingDbConnId = 'db' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            }
            const payload = {
                id: editingDbConnId,
                name,
                description: document.getElementById('dbConnDesc').value.trim(),
                type: document.getElementById('dbConnType').value,
                host,
                port: Number(document.getElementById('dbConnPort').value) || undefined,
                database: document.getElementById('dbConnDatabase').value.trim(),
                username: document.getElementById('dbConnUser').value.trim(),
                password: document.getElementById('dbConnPassword').value
            };
            savingDbConn = true;
            const saveBtn = document.querySelector('#dbConnFormModal .btn-save-rules');
            if (saveBtn) saveBtn.disabled = true;
            document.getElementById('dbConnFormStatus').textContent = '保存中…';
            try {
                const res = await fetch('./api/db-connections', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                const saved = result.data && result.data.item;
                document.getElementById('dbConnPassword').value = '';
                await loadDbConnections();
                if (saved && saved.id) {
                    renderDbConnSelect(saved.id);
                    refreshPersistConnectionSelects(saved.id);
                }
                closeDbConnForm();
                var msg = '已保存到本机数据库';
                if (result.data && result.data.mysql) {
                    msg += '，并已写入 MySQL ' + (result.data.mysqlDatabase || '');
                } else if (result.data && result.data.mysqlError) {
                    msg += '；写入 MySQL 失败：' + result.data.mysqlError;
                }
                document.getElementById('dbConnStatus').textContent = msg;
            } catch (e) {
                document.getElementById('dbConnFormStatus').textContent = e.message || '保存失败';
            } finally {
                savingDbConn = false;
                if (saveBtn) saveBtn.disabled = false;
            }
        }

        document.addEventListener('click', (event) => {
            const wrap = event.target && event.target.closest && event.target.closest('.post-op-wrap');
            if (!wrap) closePostOpMenu();
            const dyn = event.target && event.target.closest && event.target.closest('.db-dyn-wrap');
            if (!dyn) closeDbDynMenu();
            const more = event.target && event.target.closest && event.target.closest('.conn-more');
            if (!more) closeConnMoreMenus();
        });

        document.addEventListener('click', (event) => {
            const btn = event.target && event.target.closest && event.target.closest('.jp-extract');
            if (!btn) return;
            event.preventDefault();
            const header = btn.getAttribute('data-header');
            if (header) applyExtractHeader(header);
            else applyExtractPath(btn.getAttribute('data-path'));
        }, true);

        async function clearRecords() {
            if (!confirm('确定清空全部记录？')) return;
            try {
                const res = await fetch('./api/clear', { method: 'POST' });
                if (!res.ok) throw new Error('Clear failed');
                selectedId = '';
                selectedRecord = null;
                checkedIdSet.clear();
                document.getElementById('detailPanel').innerHTML = '<h3>请求详情</h3><p class="hint">点击表格中的一行查看请求/响应报文。</p>';
                loadRecords();
            } catch (e) {
                alert('清空失败');
            }
        }

        async function deleteSelected() {
            const ids = getCheckedIds();
            if (ids.length === 0) {
                alert('请先勾选要删除的记录');
                return;
            }
            if (!confirm(`确定删除勾选的 ${ids.length} 条？`)) return;
            try {
                const res = await fetch('./api/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
                if (!res.ok) throw new Error('Delete failed');
                ids.forEach((id) => checkedIdSet.delete(String(id)));
                if (ids.includes(selectedId)) {
                    selectedId = '';
                    selectedRecord = null;
                    document.getElementById('detailPanel').innerHTML = '<h3>请求详情</h3><p class="hint">点击表格中的一行查看请求/响应报文。</p>';
                }
                loadRecords();
            } catch (e) {
                alert('删除失败');
            }
        }
