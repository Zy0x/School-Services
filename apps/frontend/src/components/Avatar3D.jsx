export default function Avatar3D({ icon = "/icon.png", label = "School Services", size = "lg" }) {
  return (
    <div className={`avatar-3d circle-brand-icon circle-brand-icon-${size}`} aria-label={label}>
      <span className="circle-brand-glow" aria-hidden="true" />
      <div className="circle-brand-frame">
        <img src={icon} alt="" aria-hidden="true" />
      </div>
    </div>
  );
}
