export default function handler(req, res) {
  res.status(200).json({ status: 'ok', service: 'agent-web-graph', version: '1.0.0' });
}
