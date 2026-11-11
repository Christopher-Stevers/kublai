import React from "react";
import { createRoot } from "react-dom/client";
import PartImage from "../../../src/components/catalogue/PartImage";
const root = createRoot(document.getElementById("root"));
window.renderFixture = (epoch, count = 1) =>
  root.render(
    <div key={epoch} style={{ display: "flex", gap: 20 }}>
      {Array.from({ length: count }, (_, index) => (
        <React.Fragment key={index}>
          <div
            data-case={`fill-${index}`}
            style={{ position: "relative", width: 160, height: 120 }}
          >
            <PartImage
              src="/api/catalogue/images/synthetic.svg"
              alt={`Fill ${index}`}
              fill
              unoptimized
            />
          </div>
          <div data-case={`fixed-${index}`}>
            <PartImage
              src="/api/catalogue/images/synthetic.svg"
              alt={`Fixed ${index}`}
              width={96}
              height={72}
              unoptimized
            />
          </div>
        </React.Fragment>
      ))}
    </div>,
  );
window.renderFixture("initial");
