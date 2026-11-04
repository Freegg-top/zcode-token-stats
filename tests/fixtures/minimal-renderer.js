const Q = require('react');
const $ = { jsx: (type, props) => ({ type, props }) };
const im = { createPortal: (node, target) => ({ node, target }) };
const { zcodeAgentService } = ed();

function Composer({ workspacePath: e, workspaceIdentity: t, sessionId: n, snapshot: r }) {
  const [state] = Q.useState(0);
  im.createPortal(null, null);
  return (0, $.jsx)('div', {
    children: [
      (0, $.jsx)('span', { 'data-usage-used': true }),
    ],
  });
}

function Wrapper({ workspacePath: e, workspaceIdentity: t, sessionId: n, snapshot: r }) {
  return (0, $.jsx)(Composer, { workspacePath: e, workspaceIdentity: t, sessionId: n, snapshot: r });
}

module.exports = { Composer, Wrapper };
