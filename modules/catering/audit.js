// Änderungsprotokoll: wer hat wann was geändert. Enthält keine Zugangsdaten.
function createAudit(db) {
  const userName = db.prepare('SELECT full_name FROM users WHERE id = ?');
  const insert = db.prepare('INSERT INTO catering_audit_log (user_id, user_name, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)');
  return function audit(req, entity, entityId, action, detail) {
    const uid = req && req.session ? req.session.userId : null;
    const u = uid ? userName.get(uid) : null;
    insert.run(uid || null, u ? u.full_name : null, entity, entityId === undefined || entityId === null ? null : String(entityId),
      action, detail === undefined ? null : JSON.stringify(detail));
  };
}
module.exports = { createAudit };
