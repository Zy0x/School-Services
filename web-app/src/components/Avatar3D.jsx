export default function Avatar3D({ icon = "/icon.png", label = "School Services", size = "lg" }) {
  return (
    <div className={`avatar-3d avatar-3d-${size}`} aria-label={label}>
      <div className="avatar-3d-orb">
        <img src={icon} alt="" aria-hidden="true" />
      </div>
      <span className="avatar-3d-ring" aria-hidden="true" />
    </div>
  );
}
