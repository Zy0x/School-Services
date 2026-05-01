export function Modal({ title, children, onClose }) {
  return (
    <div className="detail-drawer-backdrop" role="dialog" aria-modal="true">
      <section className="detail-drawer">
        <div className="detail-drawer-header">
          <strong>{title}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Tutup">
            x
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
