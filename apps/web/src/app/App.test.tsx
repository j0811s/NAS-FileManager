import { render, screen } from "@testing-library/react";
import { App } from "@/app/App";

test("renders app heading", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "NAS-FileManager" })).toBeDefined();
});
