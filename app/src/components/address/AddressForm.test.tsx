import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressForm, addressFormFromPartial, emptyAddressForm } from "./AddressForm";

describe("AddressForm", () => {
  afterEach(cleanup);

  it("renders every IAddress-backed field with a label", () => {
    render(<AddressForm value={emptyAddressForm} onChange={vi.fn()} onSubmit={vi.fn()} submitLabel="ثبت" />);
    for (const label of ["نام گیرنده", "شماره تماس", "استان", "شهر", "منطقه", "محله", "خیابان", "کوچه", "پلاک", "واحد", "آدرس کامل", "کد پستی", "توضیحات برای پیک"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("calls onChange with the updated field, keeping the rest of the form intact", () => {
    const onChange = vi.fn();
    render(<AddressForm value={emptyAddressForm} onChange={onChange} onSubmit={vi.fn()} submitLabel="ثبت" />);
    fireEvent.change(screen.getByLabelText("شهر"), { target: { value: "زنجان" } });
    expect(onChange).toHaveBeenCalledWith({ ...emptyAddressForm, city: "زنجان" });
  });

  it("submits the current value and shows a saving state / server error", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<AddressForm value={emptyAddressForm} onChange={vi.fn()} onSubmit={onSubmit} submitLabel="ثبت" />);
    fireEvent.click(screen.getByRole("button", { name: "ثبت" }));
    expect(onSubmit).toHaveBeenCalledWith(emptyAddressForm);

    rerender(<AddressForm value={emptyAddressForm} onChange={vi.fn()} onSubmit={onSubmit} submitLabel="ثبت" error="خطا رخ داد" />);
    expect(screen.getByRole("alert")).toHaveTextContent("خطا رخ داد");
  });

  it("addressFormFromPartial converts null/undefined server fields to empty strings for controlled inputs", () => {
    const form = addressFormFromPartial({ city: "زنجان", district: null, street: undefined });
    expect(form.city).toBe("زنجان");
    expect(form.district).toBe("");
    expect(form.street).toBe("");
    expect(form.province).toBe(""); // untouched fields keep the empty default
  });
});
