'use client'

import { useId } from "react";

interface FormFieldProps {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  errors?: string[];
  required?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

export function FormField({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  errors,
  required,
  autoComplete,
  autoFocus,
  disabled,
}: FormFieldProps) {
  const id = useId();

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-navy-200"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={disabled}
        className="input-field focus-ring"
      />
      {errors && errors.length > 0 && (
        <div className="flex items-start gap-1.5 pt-0.5">
          <svg
            className="w-3.5 h-3.5 text-critical mt-0.5 shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-xs text-critical-light">{errors[0]}</p>
        </div>
      )}
    </div>
  );
}
