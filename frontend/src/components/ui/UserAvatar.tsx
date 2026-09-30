import type { User } from "../../api";

export function UserAvatar({
  user,
  className,
}: {
  user: User;
  className?: string;
}) {
  if (user.avatar) {
    return (
      <img
        className={className}
        src={user.avatar}
        referrerPolicy="no-referrer"
        alt={user.name}
      />
    );
  }

  return (
    <span
      className={`${className ? `${className} ` : ""}avatar-fallback`}
      aria-label={user.name}
    >
      {user.name.slice(0, 2).toUpperCase()}
    </span>
  );
}
