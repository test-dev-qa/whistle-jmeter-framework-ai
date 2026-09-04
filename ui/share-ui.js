'use strict';
// Share docs UI — extracted from index.html

        // —— 分享文档 ——
        let shareDocsState = { stations: [], docs: [], nav: 'online', stationId: '', q: '', searchTimer: null };

        function shareExpireLabel(expireAt) {
            if (expireAt == null || expireAt === '') return '永久有效';
            const n = Number(expireAt);
            if (!Number.isFinite(n) || n <= 0) return '永久有效';
            if (Date.now() > n) return '已过期';
            const d = new Date(n);
            return '至 ' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }

        function shareDateLabel(ts) {
            const n = Number(ts);
            if (!Number.isFinite(n) || n <= 0) return '-';
            const d = new Date(n);
            const pad = (v) => String(v).padStart(2, '0');
            return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 '
                + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        }

        function shareStationName(id) {
            const s = (shareDocsState.stations || []).find((x) => x.id === id);
            return s ? s.name : (id || '本机');
        }

        function shareViewUrl(doc) {
            return pluginApiUrl('share/' + encodeURIComponent(doc.slug || doc.id));
        }

        function roughMarkdownPreview(md) {
            let s = escapeHtml(md || '');
            s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
            s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
            s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
            s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
            s = s.replace(/^\- (.+)$/gm, '<li>$1</li>');
            s = s.replace(/(<li>.*<\/li>\n?)+/g, (m) => '<ul>' + m + '</ul>');
            s = s.replace(/\n\n/g, '<br><br>');
            return s;
        }

        let shareRichSourceMode = false;

        function isShareRichFormat(format) {
            const f = format || (document.getElementById('shareDocFormat') && document.getElementById('shareDocFormat').value);
            return f === 'html' || f === 'doc';
        }

        function getShareDocContent() {
            const format = document.getElementById('shareDocFormat').value;
            const ta = document.getElementById('shareDocContent');
            const editor = document.getElementById('shareRichEditor');
            if (isShareRichFormat(format)) {
                if (shareRichSourceMode) return ta.value || '';
                return editor ? editor.innerHTML : (ta.value || '');
            }
            return ta ? ta.value || '' : '';
        }

        function setShareDocContent(content, format) {
            const fmt = format || document.getElementById('shareDocFormat').value;
            const ta = document.getElementById('shareDocContent');
            const editor = document.getElementById('shareRichEditor');
            const text = content == null ? '' : String(content);
            if (ta) ta.value = text;
            if (editor) {
                if (isShareRichFormat(fmt) && !shareRichSourceMode) {
                    editor.innerHTML = text || '';
                } else {
                    editor.innerHTML = '';
                }
            }
        }

        function syncShareEditorMode() {
            const format = document.getElementById('shareDocFormat').value;
            const rich = isShareRichFormat(format);
            const richToolbar = document.getElementById('shareRichToolbar');
            const mdToolbar = document.getElementById('shareMdToolbar');
            const ta = document.getElementById('shareDocContent');
            const editor = document.getElementById('shareRichEditor');
            if (!ta || !editor) return;

            ta.classList.remove('share-html-source');
            ta.classList.add('share-md-editor');

            if (!rich) {
                shareRichSourceMode = false;
                if (!ta.value && editor.innerHTML && editor.innerHTML !== '<br>') {
                    ta.value = editor.innerHTML;
                }
                editor.innerHTML = '';
                editor.hidden = true;
                ta.hidden = false;
                if (richToolbar) richToolbar.hidden = true;
                if (mdToolbar) mdToolbar.hidden = false;
                return;
            }

            if (mdToolbar) mdToolbar.hidden = true;
            if (richToolbar) richToolbar.hidden = false;

            if (shareRichSourceMode) {
                if (!ta.value && editor.innerHTML && editor.innerHTML !== '<br>') {
                    ta.value = editor.innerHTML;
                }
                editor.hidden = true;
                ta.hidden = false;
                ta.classList.add('share-html-source');
                ta.classList.remove('share-md-editor');
            } else {
                if (ta.value && (!editor.innerHTML || editor.innerHTML === '<br>')) {
                    editor.innerHTML = ta.value;
                }
                ta.hidden = true;
                editor.hidden = false;
            }
        }

        function shareMdWrap(before, after) {
            const ta = document.getElementById('shareDocContent');
            if (!ta || ta.hidden) return;
            const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
            const end = ta.selectionEnd == null ? start : ta.selectionEnd;
            const selected = ta.value.slice(start, end) || '文本';
            const insert = before + selected + after;
            ta.setRangeText(insert, start, end, 'end');
            ta.focus();
            refreshShareDocPreview();
        }

        function shareMdInsertHeading(level) {
            const ta = document.getElementById('shareDocContent');
            if (!ta || ta.hidden) return;
            const prefix = '#'.repeat(Math.max(1, Math.min(3, Number(level) || 2))) + ' ';
            const start = ta.selectionStart == null ? 0 : ta.selectionStart;
            const lineStart = ta.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
            const lineEndRaw = ta.value.indexOf('\n', start);
            const lineEnd = lineEndRaw < 0 ? ta.value.length : lineEndRaw;
            const line = ta.value.slice(lineStart, lineEnd).replace(/^#+\s*/, '');
            ta.setRangeText(prefix + line, lineStart, lineEnd, 'end');
            ta.focus();
            refreshShareDocPreview();
        }

        function shareMdInsertList(marker) {
            const ta = document.getElementById('shareDocContent');
            if (!ta || ta.hidden) return;
            const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
            const end = ta.selectionEnd == null ? start : ta.selectionEnd;
            const selected = ta.value.slice(start, end);
            const block = selected
                ? selected.split('\n').map((line) => marker + line).join('\n')
                : marker + '列表项';
            ta.setRangeText(block, start, end, 'end');
            ta.focus();
            refreshShareDocPreview();
        }

        function shareMdInsertLink() {
            const ta = document.getElementById('shareDocContent');
            if (!ta || ta.hidden) return;
            const url = window.prompt('输入链接 URL', 'https://');
            if (!url) return;
            const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
            const end = ta.selectionEnd == null ? start : ta.selectionEnd;
            const label = ta.value.slice(start, end) || '链接文字';
            ta.setRangeText('[' + label + '](' + url + ')', start, end, 'end');
            ta.focus();
            refreshShareDocPreview();
        }

        function shareMdInsertImage() {
            const ta = document.getElementById('shareDocContent');
            if (!ta || ta.hidden) return;
            const url = window.prompt('输入图片 URL', 'https://');
            if (!url) return;
            const alt = window.prompt('图片描述（可选）', 'image') || 'image';
            const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
            ta.setRangeText('![' + alt + '](' + url + ')', start, start, 'end');
            ta.focus();
            refreshShareDocPreview();
        }

        function onShareDocFormatChange() {
            syncShareEditorMode();
            refreshShareDocPreview();
        }

        function onShareRichInput() {
            const ta = document.getElementById('shareDocContent');
            const editor = document.getElementById('shareRichEditor');
            if (ta && editor && !shareRichSourceMode) ta.value = editor.innerHTML;
            refreshShareDocPreview();
        }

        function shareRichCmd(cmd, value) {
            const editor = document.getElementById('shareRichEditor');
            if (!editor || shareRichSourceMode) return;
            editor.focus();
            try {
                document.execCommand(cmd, false, value || null);
            } catch (e) {
                // ignore
            }
            onShareRichInput();
        }

        function shareRichInsertHtml(html) {
            const editor = document.getElementById('shareRichEditor');
            if (!editor || shareRichSourceMode) return;
            editor.focus();
            try {
                document.execCommand('insertHTML', false, html);
            } catch (e) {
                editor.innerHTML += html;
            }
            onShareRichInput();
        }

        function shareRichInsertLink() {
            const url = window.prompt('输入链接 URL', 'https://');
            if (!url) return;
            shareRichCmd('createLink', url);
        }

        function shareRichInsertImageUrl() {
            const url = window.prompt('输入图片 URL（支持 gif）', 'https://');
            if (!url) return;
            shareRichInsertHtml('<p><img src="' + escapeHtml(url) + '" alt="image"></p>');
        }

        function shareRichInsertGifUrl() {
            const url = window.prompt('输入 GIF 地址', 'https://');
            if (!url) return;
            shareRichInsertHtml('<p><img src="' + escapeHtml(url) + '" alt="gif"></p>');
        }

        function shareRichInsertVideoUrl() {
            const url = window.prompt('输入视频直链（mp4/webm）', 'https://');
            if (!url) return;
            shareRichInsertHtml(
                '<p><video controls src="' + escapeHtml(url) + '" style="max-width:100%"></video></p>'
            );
        }

        function shareRichInsertEmbed() {
            const url = window.prompt('输入嵌入地址（B站/YouTube 分享链接或 iframe src）', 'https://');
            if (!url) return;
            let src = String(url).trim();
            const bilibili = src.match(/bilibili\.com\/video\/(BV[\w]+)/i);
            const youtube = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i);
            if (bilibili) src = 'https://player.bilibili.com/player.html?bvid=' + bilibili[1] + '&high_quality=1';
            else if (youtube) src = 'https://www.youtube.com/embed/' + youtube[1];
            shareRichInsertHtml(
                '<p><iframe class="share-embed" src="' + escapeHtml(src) +
                '" allowfullscreen referrerpolicy="no-referrer"></iframe></p>'
            );
        }

        function shareRichToggleSource() {
            const ta = document.getElementById('shareDocContent');
            const editor = document.getElementById('shareRichEditor');
            if (!isShareRichFormat()) return;
            if (!shareRichSourceMode) {
                ta.value = editor.innerHTML;
                shareRichSourceMode = true;
            } else {
                editor.innerHTML = ta.value || '';
                shareRichSourceMode = false;
            }
            syncShareEditorMode();
            refreshShareDocPreview();
        }

        async function onShareMediaFile(event, kind) {
            const file = event.target && event.target.files && event.target.files[0];
            event.target.value = '';
            if (!file) return;
            const status = document.getElementById('shareDocFormStatus');
            status.textContent = '上传中…';
            try {
                const contentBase64 = await fileToBase64(file);
                const res = await fetch(pluginApiUrl('api/share/media'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({
                        filename: file.name,
                        mime: file.type,
                        contentBase64
                    })
                });
                const result = await parseJsonResponse(res);
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '上传失败');
                const url = pluginApiUrl('api/share/media/' + encodeURIComponent(result.data.name));
                if ((result.data.kind || kind) === 'video') {
                    shareRichInsertHtml(
                        '<p><video controls src="' + escapeHtml(url) + '" style="max-width:100%"></video></p>'
                    );
                } else {
                    shareRichInsertHtml('<p><img src="' + escapeHtml(url) + '" alt="' + escapeHtml(file.name) + '"></p>');
                }
                status.textContent = '媒体已插入';
            } catch (e) {
                status.textContent = e.message || '上传失败';
            }
        }

        function refreshShareDocPreview() {
            const format = document.getElementById('shareDocFormat').value;
            const content = getShareDocContent();
            const preview = document.getElementById('shareDocPreview');
            if (!preview) return;
            if (format === 'md') preview.innerHTML = roughMarkdownPreview(content);
            else preview.innerHTML = content || '';
        }

        function expireValueToTs(value) {
            if (!value) return null;
            const map = { '1d': 1, '7d': 7, '30d': 30 };
            const days = map[value];
            if (!days) return null;
            return Date.now() + days * 24 * 60 * 60 * 1000;
        }

        function renderShareStations() {
            const box = document.getElementById('shareStationList');
            const stations = shareDocsState.stations || [];
            if (!stations.length) {
                box.innerHTML = '<div class="hint" style="padding:8px 16px">暂无文档站</div>';
                return;
            }
            box.innerHTML = stations.map((s) => {
                const active = shareDocsState.nav === 'station' && shareDocsState.stationId === s.id ? ' active' : '';
                const badge = s.status === 'draft'
                    ? '<span class="share-badge draft">草稿</span>'
                    : '<span class="share-badge">已发布</span>';
                return '<div class="share-station-item' + active + '" onclick="selectShareStation(\'' + escapeHtml(s.id) + '\')">' +
                    '<div class="meta"><div class="t">' + escapeHtml(s.name) + '</div>' +
                    '<div class="s">' + escapeHtml(s.url || '') + '</div></div>' + badge + '</div>';
            }).join('');
        }

        function shareFileTypeLabel(doc) {
            const raw = (doc && (doc.fileType || doc.fileExt || doc.format)) || 'md';
            const lower = String(raw).toLowerCase().replace(/^\./, '');
            if (lower === 'mp4' || lower === 'webm' || lower === 'ogv' || lower === 'mov' || lower === 'avi') {
                return lower.toUpperCase();
            }
            if (lower === 'jpeg') return 'jpg';
            if (lower === 'markdown') return 'md';
            if (lower === 'htm') return 'html';
            return lower || 'md';
        }

        function renderShareDocsTable() {
            const tbody = document.getElementById('shareDocBody');
            const docs = shareDocsState.docs || [];
            document.getElementById('shareCount').textContent = docs.length + ' 个分享';
            if (!docs.length) {
                tbody.innerHTML = '<tr><td colspan="6" class="share-empty">暂无分享，点击「新建分享」或「导入文档」</td></tr>';
                return;
            }
            tbody.innerHTML = docs.map((doc) => {
                const typeLabel = shareFileTypeLabel(doc);
                const typeClass = String(typeLabel).toLowerCase();
                const slug = escapeHtml(doc.slug || '');
                const title = escapeHtml(doc.title || '');
                const viewUrl = escapeHtml(shareViewUrl(doc));
                return '<tr>' +
                    '<td><a class="share-doc-title-link" href="' + viewUrl + '" title="点击全屏打开文档" data-slug="' + slug + '" data-title="' + title + '" onclick="return onShareDocTitleClick(event)">' + title + '</a>' +
                    '<div class="share-doc-slug">' + viewUrl + '</div></td>' +
                    '<td><span class="share-fmt ' + escapeHtml(typeClass) + '">' + escapeHtml(typeLabel) + '</span></td>' +
                    '<td>' + escapeHtml(shareStationName(doc.stationId)) + '</td>' +
                    '<td>' + escapeHtml(shareExpireLabel(doc.expireAt)) + '</td>' +
                    '<td>' + escapeHtml(shareDateLabel(doc.createdAt)) + '</td>' +
                    '<td><div class="share-row-actions">' +
                    '<button type="button" onclick="openShareDocForm(\'' + escapeHtml(doc.id) + '\')">编辑</button>' +
                    '<button type="button" onclick="openShareDocView(\'' + slug + '\', { title: \'' + title.replace(/'/g, "\\'") + '\' })">打开</button>' +
                    '<button type="button" onclick="copyShareDocLink(\'' + slug + '\')">复制链接</button>' +
                    '<button type="button" onclick="downloadShareDoc(\'' + escapeHtml(doc.id) + '\')">下载</button>' +
                    '<button type="button" title="写入 MemoryBridge 锚点（不改正文）" onclick="pinShareDocMemory(\'' + escapeHtml(doc.id) + '\')">记忆锚点</button>' +
                    '<button type="button" onclick="deleteShareDoc(\'' + escapeHtml(doc.id) + '\')">删除</button>' +
                    '</div></td></tr>';
            }).join('');
        }

        function fillShareStationSelect(selected) {
            const sel = document.getElementById('shareDocStation');
            const stations = shareDocsState.stations || [];
            sel.innerHTML = stations.map((s) =>
                '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>'
            ).join('') || '<option value="local">本机文档站</option>';
            if (selected) sel.value = selected;
        }

        async function parseJsonResponse(res) {
            const text = await res.text();
            let result = null;
            try {
                result = text ? JSON.parse(text) : null;
            } catch (e) {
                const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 80);
                throw new Error(res.ok
                    ? ('接口返回非 JSON：' + snippet)
                    : ('请求失败 HTTP ' + res.status + (snippet ? (' · ' + snippet) : '')));
            }
            return result || {};
        }

        function updateShareMemoryBridgeBadge(data) {
            const el = document.getElementById('shareMemoryBridgeBadge');
            if (!el) return;
            if (!data) {
                el.className = 'share-mb-badge unknown';
                el.textContent = 'MB ?';
                el.title = 'MemoryBridge 状态未知';
                return;
            }
            if (data.available) {
                el.className = 'share-mb-badge ok';
                const via = data.via === 'python-module' ? 'py' : (data.via || 'ok');
                el.textContent = 'MB ' + (data.version || '就绪').replace(/^membridge\s*/i, '');
                el.title = 'MemoryBridge 可用（' + via + '）\n' + (data.stats || '').slice(0, 200);
            } else {
                el.className = 'share-mb-badge warn';
                el.textContent = 'MB 未就绪';
                el.title = data.error || '未找到 membridge CLI';
            }
        }

        async function loadShareOverview() {
            const status = document.getElementById('shareStatus');
            status.textContent = '加载中…';
            updateShareMemoryBridgeBadge(null);
            try {
                const qs = new URLSearchParams();
                if (shareDocsState.q) qs.set('q', shareDocsState.q);
                const [res, mbRes] = await Promise.all([
                    fetch(pluginApiUrl('api/share/overview?' + qs.toString())),
                    fetch(pluginApiUrl('api/memory-bridge/status')).catch(() => null)
                ]);
                const result = await parseJsonResponse(res);
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '加载失败');
                shareDocsState.stations = (result.data && result.data.stations) || [];
                let docs = (result.data && result.data.docs) || [];
                if (shareDocsState.nav === 'station' && shareDocsState.stationId) {
                    docs = docs.filter((d) => d.stationId === shareDocsState.stationId);
                }
                shareDocsState.docs = docs;
                renderShareStations();
                renderShareDocsTable();
                if (mbRes && mbRes.ok) {
                    const mb = await mbRes.json().catch(() => null);
                    updateShareMemoryBridgeBadge(mb && mb.data);
                }
                status.textContent = '';
            } catch (e) {
                status.textContent = e.message || '加载失败';
            }
        }

        function selectShareNav(nav) {
            shareDocsState.nav = nav || 'online';
            shareDocsState.stationId = '';
            document.getElementById('shareNavOnline').classList.toggle('active', shareDocsState.nav === 'online');
            document.getElementById('shareMainTitle').textContent = '在线文档列表';
            loadShareOverview();
        }

        function selectShareStation(id) {
            shareDocsState.nav = 'station';
            shareDocsState.stationId = id;
            document.getElementById('shareNavOnline').classList.remove('active');
            const st = (shareDocsState.stations || []).find((x) => x.id === id);
            document.getElementById('shareMainTitle').textContent = (st && st.name) || '文档站';
            loadShareOverview();
        }

        function onShareSearchInput() {
            const q = document.getElementById('shareSearch').value || '';
            if (shareDocsState.searchTimer) clearTimeout(shareDocsState.searchTimer);
            shareDocsState.searchTimer = setTimeout(() => {
                shareDocsState.q = q.trim();
                loadShareOverview();
            }, 220);
        }

        async function openShareDocsModal() {
            document.getElementById('shareDocsModal').hidden = false;
            document.body.style.overflow = 'hidden';
            shareDocsState.nav = 'online';
            shareDocsState.stationId = '';
            shareDocsState.q = '';
            document.getElementById('shareSearch').value = '';
            document.getElementById('shareNavOnline').classList.add('active');
            document.getElementById('shareMainTitle').textContent = '在线文档列表';
            await loadShareOverview();
        }

        function closeShareDocsModal() {
            document.getElementById('shareDocsModal').hidden = true;
            document.body.style.overflow = '';
            closeShareDocForm();
            closeShareStationForm();
        }

        function openShareStationForm() {
            document.getElementById('shareStationFormModal').hidden = false;
            document.getElementById('shareStationName').value = '';
            document.getElementById('shareStationUrl').value = '';
            document.getElementById('shareStationFormStatus').textContent = '';
        }

        function closeShareStationForm() {
            document.getElementById('shareStationFormModal').hidden = true;
        }

        async function saveShareStationForm() {
            const status = document.getElementById('shareStationFormStatus');
            status.textContent = '创建中…';
            try {
                const res = await fetch(pluginApiUrl('api/share/stations'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: document.getElementById('shareStationName').value,
                        url: document.getElementById('shareStationUrl').value
                    })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '创建失败');
                closeShareStationForm();
                await loadShareOverview();
            } catch (e) {
                status.textContent = e.message || '创建失败';
            }
        }

        async function openShareDocForm(id) {
            try {
                // 确保分享文档壳层已打开，编辑页再全屏覆盖
                const shell = document.getElementById('shareDocsModal');
                if (shell && shell.hidden) {
                    await openShareDocsModal();
                }
                const modal = document.getElementById('shareDocFormModal');
                if (!modal) throw new Error('新建分享弹层缺失，请 Ctrl+F5 强刷');
                modal.hidden = false;
                document.body.style.overflow = 'hidden';
                document.getElementById('shareDocFormStatus').textContent = '';
                fillShareStationSelect(shareDocsState.stationId || 'local');
                document.getElementById('shareDocExpire').value = '';
                if (!id) {
                    document.getElementById('shareDocFormTitle').textContent = '新建分享';
                    document.getElementById('shareDocEditId').value = '';
                    const versionsBtn = document.getElementById('shareDocVersionsBtn');
                    if (versionsBtn) versionsBtn.hidden = true;
                    const wikiBtn = document.getElementById('shareDocWikiIngestBtn');
                    if (wikiBtn) wikiBtn.hidden = true;
                    document.getElementById('shareDocTitle').value = '';
                    document.getElementById('shareDocFormat').value = 'html';
                    shareRichSourceMode = false;
                    setShareDocContent('<h2>新文档</h2><p>在此输入富文本内容，可插入 <strong>GIF</strong> / 视频。</p>', 'html');
                    syncShareEditorMode();
                    refreshShareDocPreview();
                    setTimeout(() => {
                        const title = document.getElementById('shareDocTitle');
                        if (title) title.focus();
                    }, 0);
                    return;
                }
                document.getElementById('shareDocFormTitle').textContent = '编辑分享';
                document.getElementById('shareDocEditId').value = id;
                const versionsBtn = document.getElementById('shareDocVersionsBtn');
                if (versionsBtn) versionsBtn.hidden = false;
                const wikiBtn = document.getElementById('shareDocWikiIngestBtn');
                if (wikiBtn) wikiBtn.hidden = false;
                const res = await fetch(pluginApiUrl('api/share/docs/' + encodeURIComponent(id)));
                const result = await parseJsonResponse(res);
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '读取失败');
                const d = result.data || {};
                document.getElementById('shareDocTitle').value = d.title || '';
                document.getElementById('shareDocFormat').value = d.format || 'html';
                fillShareStationSelect(d.stationId || 'local');
                shareRichSourceMode = false;
                setShareDocContent(d.content || '', d.format || 'html');
                document.getElementById('shareDocExpire').value = '';
                syncShareEditorMode();
                refreshShareDocPreview();
            } catch (e) {
                const status = document.getElementById('shareDocFormStatus') || document.getElementById('shareStatus');
                if (status) status.textContent = e.message || '打开新建分享失败';
            }
        }

        function closeShareDocForm() {
            document.getElementById('shareDocFormModal').hidden = true;
            const versionsBtn = document.getElementById('shareDocVersionsBtn');
            if (versionsBtn) versionsBtn.hidden = true;
            const wikiBtn = document.getElementById('shareDocWikiIngestBtn');
            if (wikiBtn) wikiBtn.hidden = true;
            // 仍停留在分享文档全屏列表；仅当分享壳也关闭时才恢复滚动
            const shell = document.getElementById('shareDocsModal');
            if (!shell || shell.hidden) document.body.style.overflow = '';
        }

        async function ingestShareDocToWiki() {
            const status = document.getElementById('shareDocFormStatus');
            const id = String(document.getElementById('shareDocEditId').value || '').trim();
            if (!id) {
                if (status) status.textContent = '请先保存文档再入库 Wiki';
                return;
            }
            if (status) status.textContent = '入库 Wiki 中…';
            try {
                const res = await fetch(pluginApiUrl(
                    'api/share/docs/' + encodeURIComponent(id) + '/wiki-ingest'
                ), { method: 'POST' });
                const result = await parseJsonResponse(res);
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '入库失败');
                const data = result.data || {};
                const pathHint = data.articlePath ? (' → ' + data.articlePath) : '';
                if (status) status.textContent = (result.msg || '已入库 Wiki') + pathHint;
            } catch (e) {
                if (status) status.textContent = e.message || '入库失败';
            }
        }

        let shareDocVersionsDocId = '';
        let shareDocVersionsItems = [];

        function shareDocVersionLabel(item) {
            const when = new Date(item.savedAt || 0).toLocaleString();
            return when + ' (' + String(item.id || '') + ')';
        }

        function fillShareDocVersionSelects(items) {
            const fromSel = document.getElementById('shareDocVersionFrom');
            const toSel = document.getElementById('shareDocVersionTo');
            if (!fromSel || !toSel) return;
            const opts = (items || []).map((item) =>
                '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(shareDocVersionLabel(item)) + '</option>'
            ).join('');
            fromSel.innerHTML = opts;
            toSel.innerHTML = opts;
            if (items.length >= 2) {
                fromSel.value = items[1].id;
                toSel.value = items[0].id;
            } else if (items.length === 1) {
                fromSel.value = items[0].id;
                toSel.value = items[0].id;
            }
        }

        function closeShareDocVersionsModal() {
            document.getElementById('shareDocVersionsModal').hidden = true;
            shareDocVersionsDocId = '';
            shareDocVersionsItems = [];
            const diffPanel = document.getElementById('shareDocVersionDiffPanel');
            if (diffPanel) diffPanel.hidden = true;
        }

        async function compareShareDocVersions() {
            const id = shareDocVersionsDocId || String(document.getElementById('shareDocEditId').value || '').trim();
            const from = document.getElementById('shareDocVersionFrom').value;
            const to = document.getElementById('shareDocVersionTo').value;
            const vStatus = document.getElementById('shareDocVersionsStatus');
            const diffPanel = document.getElementById('shareDocVersionDiffPanel');
            const diffSummary = document.getElementById('shareDocVersionDiffSummary');
            const diffBody = document.getElementById('shareDocVersionDiffBody');
            if (!id || !from || !to) return;
            if (from === to) {
                if (vStatus) vStatus.textContent = '请选择两个不同版本';
                return;
            }
            if (vStatus) vStatus.textContent = '对比中…';
            try {
                const url = pluginApiUrl(
                    'api/share/docs/' + encodeURIComponent(id) + '/versions/diff?from=' +
                    encodeURIComponent(from) + '&to=' + encodeURIComponent(to)
                );
                const res = await fetch(url);
                const result = await parseJsonResponse(res);
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '对比失败');
                const data = result.data || {};
                const stats = data.stats || {};
                if (diffSummary) {
                    diffSummary.textContent = '删除 ' + (stats.removed || 0) + ' 行 · 新增 ' + (stats.added || 0) + ' 行 · 未变 ' + (stats.unchanged || 0) + ' 行';
                }
                const lines = data.lines || [];
                if (diffBody) {
                    if (!lines.length) {
                        diffBody.textContent = '（无差异）';
                    } else {
                        diffBody.innerHTML = lines.map((line) => {
                            const prefix = line.op === 'add' ? '+ ' : '- ';
                            const cls = line.op === 'add' ? 'diff-add' : 'diff-del';
                            return '<span class="' + cls + '">' + escapeHtml(prefix + String(line.text || '')) + '</span>';
                        }).join('');
                    }
                }
                if (diffPanel) diffPanel.hidden = false;
                if (vStatus) vStatus.textContent = '';
            } catch (e) {
                if (vStatus) vStatus.textContent = e.message || '对比失败';
            }
        }

        async function restoreShareDocVersion(versionId) {
            const id = shareDocVersionsDocId || String(document.getElementById('shareDocEditId').value || '').trim();
            const status = document.getElementById('shareDocVersionsStatus');
            if (!id || !versionId) return;
            if (!confirm('确认恢复该版本？当前未保存内容将丢失。')) return;
            if (status) status.textContent = '恢复中…';
            try {
                const restoreRes = await fetch(pluginApiUrl(
                    'api/share/docs/' + encodeURIComponent(id) + '/versions/' + encodeURIComponent(versionId) + '/restore'
                ), { method: 'POST' });
                const restoreResult = await parseJsonResponse(restoreRes);
                if (!restoreRes.ok || restoreResult.code !== 0) throw new Error(restoreResult.msg || '恢复失败');
                const d = restoreResult.data || {};
                document.getElementById('shareDocFormat').value = d.format || document.getElementById('shareDocFormat').value;
                shareRichSourceMode = false;
                setShareDocContent(d.content || '', d.format || document.getElementById('shareDocFormat').value);
                syncShareEditorMode();
                refreshShareDocPreview();
                closeShareDocVersionsModal();
                const formStatus = document.getElementById('shareDocFormStatus');
                if (formStatus) formStatus.textContent = restoreResult.msg || '已恢复版本';
            } catch (e) {
                if (status) status.textContent = e.message || '恢复失败';
            }
        }

        async function openShareDocVersions() {
            const status = document.getElementById('shareDocFormStatus');
            const id = String(document.getElementById('shareDocEditId').value || '').trim();
            if (!id) {
                if (status) status.textContent = '请先保存文档';
                return;
            }
            shareDocVersionsDocId = id;
            document.getElementById('shareDocVersionsModal').hidden = false;
            const vStatus = document.getElementById('shareDocVersionsStatus');
            const tbody = document.getElementById('shareDocVersionsBody');
            const diffPanel = document.getElementById('shareDocVersionDiffPanel');
            if (diffPanel) diffPanel.hidden = true;
            if (vStatus) vStatus.textContent = '加载中…';
            if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="empty-state">加载中…</td></tr>';
            try {
                const res = await fetch(pluginApiUrl('api/share/docs/' + encodeURIComponent(id) + '/versions'));
                const result = await parseJsonResponse(res);
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '读取失败');
                const items = (result.data && result.data.items) || [];
                shareDocVersionsItems = items;
                fillShareDocVersionSelects(items);
                if (vStatus) vStatus.textContent = items.length ? ('共 ' + items.length + ' 个版本') : '';
                if (!items.length) {
                    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="empty-state">暂无历史版本</td></tr>';
                    if (status) status.textContent = '';
                    return;
                }
                if (tbody) {
                    tbody.innerHTML = items.map((item) => {
                        const when = escapeHtml(new Date(item.savedAt || 0).toLocaleString());
                        const vid = escapeHtml(item.id);
                        return '<tr><td>' + when + '</td><td>' + escapeHtml(String(item.size || 0)) + ' B</td>' +
                            '<td>' + escapeHtml(item.format || '') + '</td>' +
                            '<td><button type="button" class="btn-ghost" onclick="restoreShareDocVersion(\'' + vid + '\')">恢复</button> ' +
                            '<button type="button" class="btn-ghost" onclick="quickCompareShareDocVersion(\'' + vid + '\')">对比</button></td></tr>';
                    }).join('');
                }
                if (status) status.textContent = '';
            } catch (e) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="empty-state">' + escapeHtml(e.message || '加载失败') + '</td></tr>';
                if (vStatus) vStatus.textContent = e.message || '加载失败';
            }
        }

        function quickCompareShareDocVersion(versionId) {
            const idx = shareDocVersionsItems.findIndex((item) => item.id === versionId);
            if (idx < 0) return;
            const toSel = document.getElementById('shareDocVersionTo');
            const fromSel = document.getElementById('shareDocVersionFrom');
            if (toSel) toSel.value = versionId;
            if (fromSel && idx + 1 < shareDocVersionsItems.length) {
                fromSel.value = shareDocVersionsItems[idx + 1].id;
            }
            compareShareDocVersions();
        }

        async function saveShareDocForm() {
            const status = document.getElementById('shareDocFormStatus');
            status.textContent = '保存中…';
            const id = String(document.getElementById('shareDocEditId').value || '').trim();
            const payload = {
                id: id || undefined,
                title: document.getElementById('shareDocTitle').value,
                format: document.getElementById('shareDocFormat').value,
                stationId: document.getElementById('shareDocStation').value,
                content: getShareDocContent(),
                expireAt: expireValueToTs(document.getElementById('shareDocExpire').value)
            };
            try {
                const res = await fetch(pluginApiUrl('api/share/save'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify(payload)
                });
                const result = await parseJsonResponse(res);
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '保存失败');
                if (result.data && result.data.id) {
                    document.getElementById('shareDocEditId').value = result.data.id;
                }
                closeShareDocForm();
                await loadShareOverview();
                const rootHint = result.docsRoot ? (' · 目录 ' + result.docsRoot) : '';
                document.getElementById('shareStatus').textContent = (result.msg || '已保存') + rootHint;
            } catch (e) {
                status.textContent = e.message || '保存失败';
            }
        }

        function triggerShareImport() {
            document.getElementById('shareImportFile').value = '';
            document.getElementById('shareImportFile').click();
        }

        function fileToBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = String(reader.result || '');
                    const idx = result.indexOf(',');
                    resolve(idx >= 0 ? result.slice(idx + 1) : result);
                };
                reader.onerror = () => reject(new Error('读取文件失败'));
                reader.readAsDataURL(file);
            });
        }

        async function onShareImportFile(event) {
            const file = event.target && event.target.files && event.target.files[0];
            if (!file) return;
            const status = document.getElementById('shareStatus');
            status.textContent = '导入中…';
            try {
                const contentBase64 = await fileToBase64(file);
                const res = await fetch(pluginApiUrl('api/share/docs/import'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: file.name,
                        contentBase64,
                        stationId: shareDocsState.stationId || 'local'
                    })
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '导入失败');
                await loadShareOverview();
                status.textContent = '已导入：' + ((result.data && result.data.title) || file.name);
                if (result.data && result.data.id) openShareDocForm(result.data.id);
            } catch (e) {
                status.textContent = e.message || '导入失败';
            } finally {
                if (event.target) event.target.value = '';
            }
        }

        async function exportShareSyncPack() {
            const status = document.getElementById('shareStatus');
            status.textContent = '正在导出同步包…';
            try {
                const withAnchors = document.getElementById('shareSyncMemoryAnchors');
                const qs = (withAnchors && withAnchors.checked) ? '?memoryAnchors=1' : '';
                const res = await fetch(pluginApiUrl('api/share/sync/export' + qs));
                if (!res.ok) {
                    const err = await res.json().catch(function () { return {}; });
                    throw new Error(err.msg || '导出失败 HTTP ' + res.status);
                }
                let metaHint = '';
                const metaHdr = res.headers.get('X-Share-Sync-Meta');
                if (metaHdr) {
                    try {
                        const meta = JSON.parse(metaHdr);
                        metaHint = '（' + (meta.docs || 0) + ' 篇文档，' + (meta.media || 0) + ' 个媒体，'
                            + Math.round((meta.bytes || 0) / 1024) + ' KB';
                        if (meta.anchors) metaHint += '，锚点 ' + (meta.anchors.ok || 0) + ' 成功';
                        metaHint += '）';
                    } catch (e) { /* ignore */ }
                }
                status.textContent = '正在打包下载…' + metaHint;
                const blob = await res.blob();
                const cd = res.headers.get('Content-Disposition') || '';
                const fnMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
                const filename = fnMatch ? decodeURIComponent(fnMatch[1]) : 'share-sync.wjesync';
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                status.textContent = '同步包已下载' + metaHint;
            } catch (e) {
                status.textContent = e.message || '导出失败';
            }
        }

        function triggerShareSyncImport() {
            const input = document.getElementById('shareSyncImportFile');
            if (input) input.click();
        }

        async function onShareSyncImportFile(event) {
            const file = event.target && event.target.files && event.target.files[0];
            if (!file) return;
            const status = document.getElementById('shareStatus');
            status.textContent = '同步包导入中…';
            try {
                const withAnchors = document.getElementById('shareSyncImportMemoryAnchors');
                const anchorQs = (withAnchors && withAnchors.checked) ? '?memoryAnchors=1' : '';
                const res = await fetch(pluginApiUrl('api/share/sync/import/binary' + anchorQs), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/gzip' },
                    body: file
                });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '同步导入失败');
                await loadShareOverview();
                const d = result.data || {};
                const anchorHint = d.anchors ? `，记忆锚点 ${d.anchors.ok || 0} 成功` : '';
                status.textContent = `同步完成：文档 ${d.docs || 0}，媒体 ${d.media || 0}，文档站 ${d.stations || 0}${anchorHint}`;
            } catch (e) {
                status.textContent = e.message || '同步导入失败';
            } finally {
                if (event.target) event.target.value = '';
            }
        }

        function onShareDocTitleClick(event) {
            // Ctrl/Cmd/Shift/中键：走真实超链接新开；普通单击：全屏打开
            if (event.defaultPrevented) return false;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) {
                return true;
            }
            event.preventDefault();
            const el = event.currentTarget;
            openShareDocView(el.getAttribute('data-slug'), { title: el.getAttribute('data-title') || '' });
            return false;
        }

        function openShareDocView(slug, opts) {
            if (!slug) return;
            const options = opts || {};
            const url = pluginApiUrl('share/' + encodeURIComponent(slug));
            // 默认全屏预览；仅显式 newTab 时新开标签
            if (options.newTab) {
                window.open(url, '_blank');
                return;
            }
            openShareDocViewer(url, options.title || slug);
        }

        function openShareDocViewer(url, title) {
            const viewer = document.getElementById('shareDocViewer');
            const frame = document.getElementById('shareDocViewerFrame');
            const titleEl = document.getElementById('shareDocViewerTitle');
            if (!viewer || !frame) {
                window.open(url, '_blank');
                return;
            }
            titleEl.textContent = title || '文档预览';
            frame.src = url;
            viewer.hidden = false;
            const req = viewer.requestFullscreen || viewer.webkitRequestFullscreen || viewer.msRequestFullscreen;
            if (typeof req === 'function') {
                try { req.call(viewer); } catch (e) { /* ignore */ }
            }
        }

        function closeShareDocViewer() {
            const viewer = document.getElementById('shareDocViewer');
            const frame = document.getElementById('shareDocViewerFrame');
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
                if (typeof exit === 'function') {
                    try { exit.call(document); } catch (e) { /* ignore */ }
                }
            }
            if (viewer) viewer.hidden = true;
            if (frame) frame.src = 'about:blank';
            if (typeof loadRecords === 'function') loadRecords();
        }

        function toggleShareDocViewerFullscreen() {
            const viewer = document.getElementById('shareDocViewer');
            if (!viewer || viewer.hidden) return;
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
                if (typeof exit === 'function') {
                    try { exit.call(document); } catch (e) { /* ignore */ }
                }
                return;
            }
            const req = viewer.requestFullscreen || viewer.webkitRequestFullscreen || viewer.msRequestFullscreen;
            if (typeof req === 'function') {
                try { req.call(viewer); } catch (e) { /* ignore */ }
            }
        }

        async function copyShareDocLink(slug) {
            if (!slug) return;
            const url = new URL(pluginApiUrl('share/' + encodeURIComponent(slug)), window.location.href).href;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(url);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = url;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
                document.getElementById('shareStatus').textContent = '已复制链接';
            } catch (e) {
                document.getElementById('shareStatus').textContent = '复制失败，请手动复制：' + url;
            }
        }

        async function fetchMemoryHandoffWorkbench() {
            const urls = [
                pluginApiUrl('api/memory-bridge/status?handoff=1'),
                pluginApiUrl('api/memory-bridge/handoff')
            ];
            let lastErr = null;
            for (let i = 0; i < urls.length; i += 1) {
                try {
                    const res = await fetch(urls[i]);
                    const result = await parseJsonResponse(res);
                    if (!res.ok || result.code !== 0) throw new Error(result.msg || '读取失败');
                    const data = result.data || {};
                    if (data.handoff) {
                        if (data.handoff.error) throw new Error(data.handoff.error);
                        return data.handoff;
                    }
                    if (data.text != null) return data;
                    throw new Error('工作台数据为空');
                } catch (e) {
                    lastErr = e;
                }
            }
            throw lastErr || new Error('读取工作台失败');
        }

        async function refreshMemoryHandoffWorkbench() {
            const preview = document.getElementById('memoryHandoffPreview');
            const status = document.getElementById('memoryHandoverStatus');
            if (preview) preview.textContent = '加载中…';
            if (status) status.textContent = '';
            try {
                const data = await fetchMemoryHandoffWorkbench();
                const text = (data && data.text) || '(工作台为空)';
                if (preview) preview.textContent = text;
            } catch (e) {
                const msg = e.message || '无法读取工作台';
                if (preview) preview.textContent = msg;
                if (status) status.textContent = msg;
                if (typeof showAppToast === 'function') showAppToast(msg, 'error');
            }
        }

        async function openMemoryHandoverModal() {
            const modal = document.getElementById('memoryHandoverModal');
            if (!modal) return;
            modal.hidden = false;
            const shareStatus = document.getElementById('shareStatus');
            if (shareStatus) shareStatus.textContent = '';
            document.getElementById('memoryHandoverStatus').textContent = '';
            await refreshMemoryHandoffWorkbench();
        }

        function closeMemoryHandoverModal() {
            document.getElementById('memoryHandoverModal').hidden = true;
        }

        async function saveMemoryHandoverCard() {
            const status = document.getElementById('memoryHandoverStatus');
            status.textContent = '写入中…';
            const payload = {
                goal: document.getElementById('mbGoal').value,
                done: document.getElementById('mbDone').value,
                failed: document.getElementById('mbFailed').value,
                next: document.getElementById('mbNext').value,
                refs: document.getElementById('mbRefs').value
            };
            try {
                const urls = [
                    pluginApiUrl('api/memory-bridge/handover'),
                    pluginApiUrl('api/memory-bridge/handoff')
                ];
                let result = null;
                let lastErr = null;
                for (let i = 0; i < urls.length; i += 1) {
                    try {
                        const res = await fetch(urls[i], {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        result = await parseJsonResponse(res);
                        if (!res.ok || result.code !== 0) throw new Error(result.msg || '写入失败');
                        lastErr = null;
                        break;
                    } catch (e) {
                        lastErr = e;
                    }
                }
                if (lastErr) throw lastErr;
                const mid = result.data && result.data.memoryId;
                status.textContent = (result.msg || '已写入') + (mid ? ' · id ' + mid : '');
                if (typeof showAppToast === 'function') showAppToast(result.msg || '交接卡已写入', 'ok');
                await refreshMemoryHandoffWorkbench();
            } catch (e) {
                status.textContent = e.message || '写入失败';
                if (typeof showAppToast === 'function') showAppToast(e.message || '写入失败', 'error');
            }
        }

        async function pinShareDocMemory(id) {
            if (!id) return;
            const status = document.getElementById('shareStatus');
            status.textContent = '写入 MemoryBridge 锚点…';
            try {
                const res = await fetch(pluginApiUrl('api/share/docs/' + encodeURIComponent(id) + '/memory-anchor'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const result = await parseJsonResponse(res);
                if (!res.ok || !result || result.code !== 0) {
                    throw new Error((result && result.msg) || '写入失败');
                }
                const mid = result.data && result.data.memoryId;
                status.textContent = mid
                    ? ('已写入记忆锚点 ' + mid + '（正文未改）')
                    : (result.msg || '已写入记忆锚点');
            } catch (e) {
                status.textContent = e.message || '写入记忆锚点失败';
            }
        }

        function downloadShareDoc(id) {
            if (!id) return;
            window.open(pluginApiUrl('api/share/docs/' + encodeURIComponent(id) + '/download'), '_blank');
        }

        async function deleteShareDoc(id) {
            if (!id || !confirm('确认删除该分享文档？')) return;
            try {
                const res = await fetch(pluginApiUrl('api/share/docs/' + encodeURIComponent(id) + '/delete'), { method: 'POST' });
                const result = await res.json();
                if (!res.ok || result.code !== 0) throw new Error(result.msg || '删除失败');
                await loadShareOverview();
            } catch (e) {
                document.getElementById('shareStatus').textContent = e.message || '删除失败';
            }
        }