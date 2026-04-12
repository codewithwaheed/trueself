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
export declare function FormField({ label, name, type, placeholder, defaultValue, errors, required, autoComplete, autoFocus, disabled, }: FormFieldProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=form-field.d.ts.map