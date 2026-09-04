'use strict';
// General settings UI — extracted from index.html

        // —— 通用设置 ——
        const GS_STORAGE_KEY = 'jmeter-exporter-general-settings';
        const GS_TAB_TITLES = {
            project: '项目设置',
            stress: '压测设置',
            env: '环境设置',
            branch: '分支管理',
            notify: '通知设置',
            datasource: '数据源设置',
            dbconn: '数据库连接'
        };
        function defaultStressSettings() {
            return { threads: 1, loops: 1, rampTime: 1 };
        }

        function normalizeStressSettings(src) {
            const body = src && typeof src === 'object' ? src : {};
            return {
                threads: Math.max(1, Math.min(1000, Number(body.threads) || 1)),
                loops: Math.max(1, Math.min(10000, Number(body.loops) || 1)),
                rampTime: Math.max(0, Math.min(3600, Number(body.rampTime) || 0))
            };
        }

        function migrateStressSettings(parsed) {
            const stress = normalizeStressSettings(parsed && parsed.stress);
            const project = (parsed && parsed.project) || {};
            if (!parsed || parsed.stress == null) {
                if (project.threads != null) stress.threads = normalizeStressSettings({ threads: project.threads }).threads;
                if (project.loops != null) stress.loops = normalizeStressSettings({ loops: project.loops }).loops;
                if (project.rampTime != null) stress.rampTime = normalizeStressSettings({ rampTime: project.rampTime }).rampTime;
            }
            return stress;
        }

        let generalSettingsState = {
            tab: 'project',
            project: { name: '', description: '' },
            stress: defaultStressSettings(),
            environments: [],
            activeEnvId: '',
            branches: [],
            activeBranchId: '',
            notify: { webhookEnabled: false, webhookUrl: '', webhookFormat: 'auto', emailEnabled: false, emailHookUrl: '', notifyEmail: '' }
        };

        function defaultGeneralSettings() {
            return {
                project: { name: '', description: '' },
                stress: defaultStressSettings(),
                environments: [],
                activeEnvId: '',
                branches: [],
                activeBranchId: '',
                notify: { webhookEnabled: false, webhookUrl: '', webhookFormat: 'auto', emailEnabled: false, emailHookUrl: '', notifyEmail: '' }
            };
        }

        function loadGeneralSettingsState() {
            const base = defaultGeneralSettings();
            try {
                const raw = localStorage.getItem(GS_STORAGE_KEY);
                if (!raw) return base;
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object') return base;
                return {
                    project: Object.assign({}, base.project, parsed.project || {}),
                    stress: migrateStressSettings(parsed),
                    environments: Array.isArray(parsed.environments) ? parsed.environments : [],
                    activeEnvId: parsed.activeEnvId || '',
                    branches: Array.isArray(parsed.branches) ? parsed.branches : [],
                    activeBranchId: parsed.activeBranchId || '',
                    notify: Object.assign({}, base.notify, parsed.notify || {})
                };
            } catch (e) {
                return base;
            }
        }

        function persistGeneralSettingsState() {
            const payload = {
                project: generalSettingsState.project,
                stress: generalSettingsState.stress,
                environments: generalSettingsState.environments,
                activeEnvId: generalSettingsState.activeEnvId,
                branches: generalSettingsState.branches,
                activeBranchId: generalSettingsState.activeBranchId,
                notify: generalSettingsState.notify
            };
            localStorage.setItem(GS_STORAGE_KEY, JSON.stringify(payload));
        }

        function setGeneralSettingsStatus(text) {
            const el = document.getElementById('gsStatus');
            if (el) el.textContent = text || '';
        }

        async function openGeneralSettingsModal() {
            generalSettingsState = Object.assign({ tab: 'project' }, loadGeneralSettingsState());
            await Promise.all([
                loadGeneralSettingsNotifyFromServer(),
                loadGeneralSettingsProjectFromServer()
            ]);
            document.getElementById('generalSettingsModal').hidden = false;
            document.body.style.overflow = 'hidden';
            fillGeneralSettingsForms();
            selectGeneralSettingsTab(generalSettingsState.tab || 'project');
            refreshGeneralSettingsDatasource();
            setGeneralSettingsStatus('');
        }

        function closeGeneralSettingsModal() {
            document.getElementById('generalSettingsModal').hidden = true;
            const share = document.getElementById('shareDocsModal');
            if (!share || share.hidden) document.body.style.overflow = '';
        }

        function selectGeneralSettingsTab(tab) {
            const key = GS_TAB_TITLES[tab] ? tab : 'project';
            generalSettingsState.tab = key;
            document.querySelectorAll('#generalSettingsModal .gs-nav-item').forEach((el) => {
                el.classList.toggle('active', el.getAttribute('data-gs-tab') === key);
            });
            document.querySelectorAll('#generalSettingsModal .gs-panel').forEach((el) => {
                el.classList.toggle('active', el.getAttribute('data-gs-panel') === key);
            });
            document.getElementById('gsMainTitle').textContent = GS_TAB_TITLES[key];
            setGeneralSettingsStatus('');
            if (key === 'datasource') refreshGeneralSettingsDatasource();
            if (key === 'dbconn') refreshGeneralSettingsDbConn();
        }

        async function refreshGeneralSettingsDbConn() {
            const status = document.getElementById('dbConnStatus');
            if (status) status.textContent = '';
            const search = document.getElementById('dbConnSearch');
            if (search) search.value = '';
            try {
                await loadDbConnections();
                if (typeof renderDbConnList === 'function') renderDbConnList();
            } catch (e) {
                if (status) status.textContent = '读取连接失败';
            }
        }

        function fillGeneralSettingsForms() {
            const p = generalSettingsState.project || {};
            document.getElementById('gsProjectName').value = p.name || '';
            document.getElementById('gsProjectDesc').value = p.description || '';
            const s = generalSettingsState.stress || defaultStressSettings();
            document.getElementById('gsDefaultThreads').value = s.threads;
            document.getElementById('gsDefaultLoops').value = s.loops;
            document.getElementById('gsDefaultRamp').value = s.rampTime;
            const n = generalSettingsState.notify || {};
            document.getElementById('gsNotifyWebhookEnabled').checked = !!n.webhookEnabled;
            document.getElementById('gsNotifyWebhookUrl').value = n.webhookUrl || '';
            document.getElementById('gsNotifyWebhookFormat').value = n.webhookFormat || 'auto';
            document.getElementById('gsNotifyEmailEnabled').checked = !!n.emailEnabled;
            document.getElementById('gsNotifyEmailHookUrl').value = n.emailHookUrl || '';
            document.getElementById('gsNotifyEmail').value = n.notifyEmail || n.email || '';
            renderGeneralSettingsEnvList();
            renderGeneralSettingsBranchList();
        }

        function saveGeneralSettingsProject() {
            generalSettingsState.project = {
                name: String(document.getElementById('gsProjectName').value || '').trim().slice(0, 120),
                description: String(document.getElementById('gsProjectDesc').value || '').trim().slice(0, 1000)
            };
            persistGeneralSettingsState();
            syncGeneralSettingsProjectToServer();
            setGeneralSettingsStatus('项目设置已保存');
            if (typeof showAppToast === 'function') showAppToast('项目设置已保存', 'ok');
        }

        async function syncGeneralSettingsProjectToServer() {
            const payload = generalSettingsState.project || {};
            try {
                await fetch(pluginApiUrl('api/general/project'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (e) {
                // ignore — localStorage 仍可用
            }
        }

        async function loadGeneralSettingsProjectFromServer() {
            try {
                const res = await fetch(pluginApiUrl('api/general/project'));
                const result = await res.json();
                if (!res.ok || result.code !== 0 || !result.data) return;
                generalSettingsState.project = Object.assign({}, generalSettingsState.project || {}, result.data);
                persistGeneralSettingsState();
            } catch (e) {
                // ignore
            }
        }

        function saveGeneralSettingsStress() {
            generalSettingsState.stress = normalizeStressSettings({
                threads: document.getElementById('gsDefaultThreads').value,
                loops: document.getElementById('gsDefaultLoops').value,
                rampTime: document.getElementById('gsDefaultRamp').value
            });
            persistGeneralSettingsState();
            document.getElementById('gsDefaultThreads').value = generalSettingsState.stress.threads;
            document.getElementById('gsDefaultLoops').value = generalSettingsState.stress.loops;
            document.getElementById('gsDefaultRamp').value = generalSettingsState.stress.rampTime;
            setGeneralSettingsStatus('压测设置已保存');
            if (typeof showAppToast === 'function') showAppToast('压测设置已保存', 'ok');
        }

        function applyStressDefaultsToToolbar() {
            saveGeneralSettingsStress();
            const s = generalSettingsState.stress;
            document.getElementById('threads').value = s.threads;
            document.getElementById('loops').value = s.loops;
            document.getElementById('rampTime').value = s.rampTime;
            setGeneralSettingsStatus('已应用到顶部工具栏');
            if (typeof showAppToast === 'function') showAppToast('已应用到顶部工具栏', 'ok');
        }

        function renderGeneralSettingsEnvList() {
            const box = document.getElementById('gsEnvList');
            const list = generalSettingsState.environments || [];
            if (!list.length) {
                box.innerHTML = '<div class="gs-list-empty">暂无环境，可在下方添加</div>';
                return;
            }
            box.innerHTML = list.map((item) => {
                const active = item.id === generalSettingsState.activeEnvId;
                return '<div class="gs-list-row">' +
                    '<div class="meta"><div class="name">' + escapeHtml(item.name || '') +
                    (active ? ' <span class="gs-tag">当前</span>' : '') + '</div>' +
                    '<div class="sub">' + escapeHtml(item.baseUrl || '-') + '</div></div>' +
                    '<button type="button" onclick="setActiveGeneralSettingsEnv(\'' + escapeHtml(item.id) + '\')">设为当前</button>' +
                    '<button type="button" onclick="removeGeneralSettingsEnv(\'' + escapeHtml(item.id) + '\')">删除</button>' +
                    '</div>';
            }).join('');
        }

        function addGeneralSettingsEnv() {
            const name = String(document.getElementById('gsEnvName').value || '').trim();
            const baseUrl = String(document.getElementById('gsEnvBaseUrl').value || '').trim();
            if (!name) {
                setGeneralSettingsStatus('请填写环境名');
                return;
            }
            const id = 'env_' + Date.now().toString(36);
            generalSettingsState.environments.push({ id, name: name.slice(0, 80), baseUrl: baseUrl.slice(0, 300) });
            if (!generalSettingsState.activeEnvId) generalSettingsState.activeEnvId = id;
            document.getElementById('gsEnvName').value = '';
            document.getElementById('gsEnvBaseUrl').value = '';
            persistGeneralSettingsState();
            renderGeneralSettingsEnvList();
            setGeneralSettingsStatus('环境已添加');
        }

        function setActiveGeneralSettingsEnv(id) {
            generalSettingsState.activeEnvId = id;
            persistGeneralSettingsState();
            renderGeneralSettingsEnvList();
            setGeneralSettingsStatus('已切换当前环境');
        }

        function removeGeneralSettingsEnv(id) {
            generalSettingsState.environments = (generalSettingsState.environments || []).filter((x) => x.id !== id);
            if (generalSettingsState.activeEnvId === id) {
                generalSettingsState.activeEnvId = (generalSettingsState.environments[0] && generalSettingsState.environments[0].id) || '';
            }
            persistGeneralSettingsState();
            renderGeneralSettingsEnvList();
            setGeneralSettingsStatus('环境已删除');
        }

        function renderGeneralSettingsBranchList() {
            const box = document.getElementById('gsBranchList');
            const list = generalSettingsState.branches || [];
            if (!list.length) {
                box.innerHTML = '<div class="gs-list-empty">暂无分支，可在下方添加</div>';
                return;
            }
            box.innerHTML = list.map((item) => {
                const active = item.id === generalSettingsState.activeBranchId;
                return '<div class="gs-list-row">' +
                    '<div class="meta"><div class="name">' + escapeHtml(item.name || '') +
                    (active ? ' <span class="gs-tag">当前</span>' : '') + '</div>' +
                    '<div class="sub">' + escapeHtml(item.note || '无备注') + '</div></div>' +
                    '<button type="button" onclick="setActiveGeneralSettingsBranch(\'' + escapeHtml(item.id) + '\')">设为当前</button>' +
                    '<button type="button" onclick="removeGeneralSettingsBranch(\'' + escapeHtml(item.id) + '\')">删除</button>' +
                    '</div>';
            }).join('');
        }

        function addGeneralSettingsBranch() {
            const name = String(document.getElementById('gsBranchName').value || '').trim();
            const note = String(document.getElementById('gsBranchNote').value || '').trim();
            if (!name) {
                setGeneralSettingsStatus('请填写分支名');
                return;
            }
            const id = 'br_' + Date.now().toString(36);
            generalSettingsState.branches.push({ id, name: name.slice(0, 80), note: note.slice(0, 200) });
            if (!generalSettingsState.activeBranchId) generalSettingsState.activeBranchId = id;
            document.getElementById('gsBranchName').value = '';
            document.getElementById('gsBranchNote').value = '';
            persistGeneralSettingsState();
            renderGeneralSettingsBranchList();
            setGeneralSettingsStatus('分支已添加');
        }

        function setActiveGeneralSettingsBranch(id) {
            generalSettingsState.activeBranchId = id;
            persistGeneralSettingsState();
            renderGeneralSettingsBranchList();
            setGeneralSettingsStatus('已切换当前分支');
        }

        function removeGeneralSettingsBranch(id) {
            generalSettingsState.branches = (generalSettingsState.branches || []).filter((x) => x.id !== id);
            if (generalSettingsState.activeBranchId === id) {
                generalSettingsState.activeBranchId = (generalSettingsState.branches[0] && generalSettingsState.branches[0].id) || '';
            }
            persistGeneralSettingsState();
            renderGeneralSettingsBranchList();
            setGeneralSettingsStatus('分支已删除');
        }

        function collectGeneralNotifyPayload() {
            return {
                webhookEnabled: document.getElementById('gsNotifyWebhookEnabled').checked,
                webhookUrl: String(document.getElementById('gsNotifyWebhookUrl').value || '').trim().slice(0, 2000),
                webhookFormat: String(document.getElementById('gsNotifyWebhookFormat').value || 'auto'),
                emailEnabled: document.getElementById('gsNotifyEmailEnabled').checked,
                emailHookUrl: String(document.getElementById('gsNotifyEmailHookUrl').value || '').trim().slice(0, 2000),
                notifyEmail: String(document.getElementById('gsNotifyEmail').value || '').trim().slice(0, 200)
            };
        }

        async function loadGeneralSettingsNotifyFromServer() {
            try {
                const res = await fetch(pluginApiUrl('api/general/notify'));
                const result = await res.json();
                if (!res.ok || result.code !== 0) return;
                generalSettingsState.notify = Object.assign({}, defaultGeneralSettings().notify, result.data || {});
                persistGeneralSettingsState();
            } catch (e) {
                // keep localStorage fallback
            }
        }

        async function saveGeneralSettingsNotify() {
            const payload = collectGeneralNotifyPayload();
            generalSettingsState.notify = payload;
            persistGeneralSettingsState();
            setGeneralSettingsStatus('保存中…');
            showAppToast('正在保存通知设置…', 'info');
            try {
                const res = await fetch(pluginApiUrl('api/general/notify'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                if (result.data) generalSettingsState.notify = Object.assign({}, payload, result.data);
                persistGeneralSettingsState();
                setGeneralSettingsStatus('通知设置已保存');
                showAppToast('通知设置已保存', 'ok');
                if (typeof renderThresholdNotifySummary === 'function') renderThresholdNotifySummary();
            } catch (e) {
                const msg = e.message || '保存失败';
                setGeneralSettingsStatus(msg);
                showAppToast(msg, 'error');
            }
        }

        async function testGeneralNotifyWebhook() {
            setGeneralSettingsStatus('正在测试 Webhook…');
            showAppToast('正在测试 Webhook…', 'info');
            try {
                const res = await fetch(pluginApiUrl('api/general/notify/test-webhook'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(collectGeneralNotifyPayload())
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '测试失败');
                const msg = result.msg || 'Webhook 测试成功';
                setGeneralSettingsStatus(msg);
                showAppToast(msg, 'ok');
            } catch (e) {
                const msg = e.message || 'Webhook 测试失败';
                setGeneralSettingsStatus(msg);
                showAppToast(msg, 'error');
            }
        }

        function dbConnectionLabel(id) {
            if (!id) return '-';
            const conn = (dbConnections || []).find((c) => c.id === id);
            if (!conn) return id;
            const name = String(conn.name || '').trim();
            return name || id;
        }

        function setGeneralSettingsDatasourceStatus(text) {
            const el = document.getElementById('gsDatasourceStatus');
            if (el) el.textContent = text || '';
            setGeneralSettingsStatus(text || '');
        }

        async function openStorageModalFromGeneralSettings() {
            if (typeof openStorageModal !== 'function') {
                setGeneralSettingsDatasourceStatus('存储设置未加载');
                return;
            }
            await openStorageModal({ aboveGeneralSettings: true });
        }

        function gsPersistEngineValue() {
            if (document.getElementById('gsPersistPostgres').checked) return 'postgres';
            if (document.getElementById('gsPersistMysql').checked) return 'mysql';
            return 'sqlite';
        }

        function fillGsPersistRemoteSelect(engine, selectedId) {
            const sel = document.getElementById('gsPersistRemoteConn');
            if (!sel) return;
            const type = engine === 'postgres' ? 'postgres' : 'mysql';
            const list = dbConnections.filter((c) => c.type === type);
            const label = engine === 'postgres' ? 'PostgreSQL' : 'MySQL';
            sel.innerHTML = list.length
                ? list.map((c) => {
                    const db = c.database || '(未填库名)';
                    const miss = c.database ? '' : ' — 需填写数据库名';
                    return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name || '') + ' · ' + escapeHtml(db) + miss + '</option>';
                }).join('')
                : '<option value="">暂无 ' + label + ' 连接，请先添加</option>';
            if (selectedId && list.some((c) => c.id === selectedId)) sel.value = selectedId;
        }

        function onGsPersistEngineChange() {
            const engine = gsPersistEngineValue();
            const remote = engine !== 'sqlite';
            const wrap = document.getElementById('gsPersistRemoteWrap');
            wrap.style.display = remote ? 'flex' : 'none';
            document.getElementById('gsPersistRemoteConn').disabled = !remote;
            if (remote) {
                fillGsPersistRemoteSelect(engine, engine === 'postgres'
                    ? captureSettings.postgresConnectionId
                    : captureSettings.mysqlConnectionId);
            }
        }

        async function refreshGeneralSettingsDatasource() {
            try { await loadDbConnections(); } catch (e) { /* ignore */ }
            const pe = captureSettings.persistEngine || 'sqlite';
            document.getElementById('gsPersistSqlite').checked = pe === 'sqlite';
            document.getElementById('gsPersistMysql').checked = pe === 'mysql';
            document.getElementById('gsPersistPostgres').checked = pe === 'postgres';
            fillGsPersistRemoteSelect(pe === 'postgres' ? 'postgres' : 'mysql', pe === 'postgres'
                ? captureSettings.postgresConnectionId
                : captureSettings.mysqlConnectionId);
            onGsPersistEngineChange();
            const engineLabel = pe === 'postgres' ? 'PostgreSQL' : (pe === 'mysql' ? 'MySQL' : 'SQLite');
            const connId = pe === 'postgres' ? captureSettings.postgresConnectionId : captureSettings.mysqlConnectionId;
            const extra = pe !== 'sqlite' ? (' · 连接 ' + dbConnectionLabel(connId)) : '';
            document.getElementById('gsDatasourceSummary').textContent = '当前：' + engineLabel + extra;
            setGeneralSettingsDatasourceStatus('');
        }

        async function saveGeneralSettingsDatasource() {
            const engine = gsPersistEngineValue();
            const remoteId = document.getElementById('gsPersistRemoteConn').value || '';
            if (engine !== 'sqlite' && !remoteId) {
                setGeneralSettingsDatasourceStatus('请选择数据库连接');
                return;
            }
            if (engine !== 'sqlite') {
                const conn = dbConnections.find((c) => c.id === remoteId);
                if (conn && !conn.database) {
                    setGeneralSettingsDatasourceStatus('所选连接未填写数据库名');
                    return;
                }
            }
            setGeneralSettingsDatasourceStatus('保存中…');
            try {
                const payload = { persistEngine: engine };
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
                const res = await fetch(pluginApiUrl('api/settings'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                if (result.data) applySettings(result.data);
                if (result.storage) storageInfo = result.storage;
                await loadRecords();
                await refreshGeneralSettingsDatasource();
                setGeneralSettingsDatasourceStatus('数据源已保存');
            } catch (e) {
                setGeneralSettingsDatasourceStatus(e.message || String(e));
            }
        }