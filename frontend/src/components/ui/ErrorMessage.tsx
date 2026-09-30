export function ErrorMessage({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="error">
      {message}
    </div>
  );
}
