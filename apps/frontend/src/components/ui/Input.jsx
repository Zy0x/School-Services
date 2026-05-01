export function Input({ label, id, ...props }) {
  return (
    <label className="masked-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} {...props} />
    </label>
  );
}
