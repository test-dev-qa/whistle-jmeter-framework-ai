'use strict';

        let websocketFrames = [];
        let selectedWebSocketFrame = null;
        let websocketFrameTimer = null;

        function wsEscape(value) {
            if (typeof escapeHtml === 'function') return escapeHtml(value);
            return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        }

        function formatWsTime(timestamp) {
            const date = new Date(Number(timestamp));
            return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : '-';
        }

        function wsPayloadText(frame) {
            if (!frame) return '';
            if (!frame.binary) return String(frame.payload || '');
            return '[Base64 binary] ' + String(frame.payload || '');
        }

        function openWebSocketFramesModal() {
            const modal = document.getElementById('websocketFramesModal');
            if (!modal) return;
            modal.hidden = false;
            loadWebSocketFrames();
            clearInterval(websocketFrameTimer);
            websocketFrameTimer = setInterval(loadWebSocketFrames, 5000);
        }

        function closeWebSocketFramesModal() {
            const modal = document.getElementById('websocketFramesModal');
            if (modal) modal.hidden = true;
            clearInterval(websocketFrameTimer);
            websocketFrameTimer = null;
        }

        async function loadWebSocketFrames() {
            const status = document.getElementById('wsFrameStatus');
            try {
                const response = await fetch('./api/websocket-frames');
                const result = await response.json();
                if (!response.ok || result.code !== 0) throw new Error(result.msg || '加载失败');
                websocketFrames = Array.isArray(result.data) ? result.data : [];
                if (status) status.textContent = websocketFrames.length + ' 条帧';
                renderWebSocketFrames();
            } catch (error) {
                if (status) status.textContent = error.message || '加载失败';
            }
        }

        function renderWebSocketFrames() {
            const body = document.getElementById('wsFrameBody');
            if (!body) return;
            const keyword = String(document.getElementById('wsFrameSearch')?.value || '').toLowerCase();
            const direction = document.getElementById('wsFrameDirection')?.value || '';
            const rows = websocketFrames.filter(frame => {
                if (direction && frame.direction !== direction) return false;
                if (!keyword) return true;
                return [frame.connectionId, frame.payload, frame.decoded && JSON.stringify(frame.decoded)].join(' ').toLowerCase().includes(keyword);
            });
            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="5" class="empty-state">暂无匹配的 WebSocket 帧</td></tr>';
                return;
            }
            body.innerHTML = rows.map((frame, index) => {
                const selected = frame === selectedWebSocketFrame ? ' selected' : '';
                const directionText = frame.direction === 'outgoing' ? '客户端 → 服务端' : '服务端 → 客户端';
                const decoded = frame.type === 'close' ? '连接关闭' : frame.decoded && frame.decoded.protocol ? frame.decoded.protocol : 'WebSocket';
                const summary = frame.type === 'close'
                    ? '关闭码 ' + frame.code + (frame.reason ? ' · ' + frame.reason : '')
                    : wsPayloadText(frame).replace(/\s+/g, ' ').slice(0, 180);
                return `<tr class="${selected}" onclick="selectWebSocketFrame(${index})"><td class="ws-time">${wsEscape(formatWsTime(frame.timestamp))}</td><td class="ws-direction ${wsEscape(frame.direction)}">${directionText}</td><td class="ws-protocol">${wsEscape(decoded)}</td><td class="ws-connection" title="${wsEscape(frame.connectionId)}">${wsEscape(frame.connectionId)}</td><td title="${wsEscape(wsPayloadText(frame))}">${wsEscape(summary)}</td></tr>`;
            }).join('');
            body._filteredRows = rows;
        }

        function selectWebSocketFrame(index) {
            const body = document.getElementById('wsFrameBody');
            const frame = body && body._filteredRows ? body._filteredRows[index] : null;
            if (!frame) return;
            selectedWebSocketFrame = frame;
            const detail = document.getElementById('wsFrameDetail');
            if (frame.type === 'close') {
                detail.innerHTML = `<h4>连接关闭</h4><dl><dt>连接</dt><dd>${wsEscape(frame.connectionId)}</dd><dt>时间</dt><dd>${wsEscape(new Date(Number(frame.timestamp)).toISOString())}</dd><dt>关闭码</dt><dd>${wsEscape(frame.code)}</dd><dt>原因</dt><dd>${wsEscape(frame.reason || '无')}</dd></dl>`;
                renderWebSocketFrames();
                return;
            }
            const decoded = frame.decoded ? JSON.stringify(frame.decoded, null, 2) : '未识别为 JSON-RPC';
            detail.innerHTML = `<h4>帧详情</h4><dl><dt>连接</dt><dd>${wsEscape(frame.connectionId)}</dd><dt>方向</dt><dd>${frame.direction === 'outgoing' ? '客户端 → 服务端' : '服务端 → 客户端'}</dd><dt>时间</dt><dd>${wsEscape(new Date(Number(frame.timestamp)).toISOString())}</dd><dt>Opcode</dt><dd>${wsEscape(frame.opcode)}</dd><dt>Fin</dt><dd>${wsEscape(frame.fin)}</dd><dt>协议解码</dt><dd>${wsEscape(frame.decoded ? frame.decoded.protocol : '无')}</dd></dl><h4>Payload</h4><pre>${wsEscape(wsPayloadText(frame))}</pre><h4>Decoded</h4><pre>${wsEscape(decoded)}</pre>`;
            renderWebSocketFrames();
        }

        async function clearWebSocketFrames() {
            if (!confirm('确定清空全部 WebSocket 帧吗？')) return;
            await fetch('./api/websocket-frames/clear', { method: 'POST' });
            selectedWebSocketFrame = null;
            const detail = document.getElementById('wsFrameDetail');
            if (detail) detail.innerHTML = '<h4>帧详情</h4><p class="hint">选择一条帧查看完整 Payload。</p>';
            await loadWebSocketFrames();
        }

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !document.getElementById('websocketFramesModal')?.hidden) closeWebSocketFramesModal();
        });