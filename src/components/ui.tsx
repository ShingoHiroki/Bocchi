/**
 * M1 の画面で使う最小限の UI プリミティブ（Tailwind）。モバイル幅優先・簡素（磨き込みは M4）。
 * ドメイン層・アダプター層には依存しない（CLAUDE.md）。
 */
import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/** スマホ幅中央寄せのページ枠。 */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col px-4 py-5">
      {children}
    </div>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{children}</h1>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-500 dark:text-zinc-400">{children}</p>;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
      {children}
    </label>
  );
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  /** true の場合、枠線・背景などの外枠スタイルを持たない裸の input を返す。
   *  「#」プレフィックスのような自前の外枠と組み合わせる場合に使う。 */
  unstyled?: boolean;
};

export function TextField({ unstyled, className, ...props }: TextFieldProps) {
  if (unstyled) {
    return (
      <input
        {...props}
        className={`w-full bg-transparent text-base text-zinc-900 outline-none dark:text-zinc-100 ${
          className ?? ""
        }`}
      />
    );
  }
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 ${
        className ?? ""
      }`}
    />
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-red-600 dark:text-red-400">{children}</p>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const base =
    "w-full rounded-lg px-4 py-2.5 text-center text-base font-medium transition disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-700"
      : "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";
  return <button {...props} className={`${base} ${styles} ${className}`} />;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
      {children}
    </Link>
  );
}
