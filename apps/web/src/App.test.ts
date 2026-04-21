import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vite-plus/test";
import { App } from "./App";

test("renders the repo contract and team surface", () => {
  const html = renderToStaticMarkup(createElement(App));

  expect(html).toContain("firapps");
  expect(html).toContain("Repo boundary");
  expect(html).toContain("Review claims");
  expect(html).toContain("Product bootstrap team");
});
