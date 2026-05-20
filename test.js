export default function Test() {
  return (
    <div>
      <p>API_BASE: {process.env.NEXT_PUBLIC_API_BASE || "NOT SET"}</p>
    </div>
  );
}
