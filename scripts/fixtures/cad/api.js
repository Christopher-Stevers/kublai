// @ts-nocheck
import { useState } from "react";
const noop = { useMutation: () => ({ mutate() {}, isPending: false }) };
const blank = {
  revision: 0,
  design: { elements: [], overrides: [] },
  updatedAt: null,
  updatedBy: null,
};
window.designSaved = blank;
export const api = {
  useUtils: () => ({ models: { design: { setData: (_key, data) => { window.designSaved = data; } }, designStatus: { setData() {} } } }),
  models: {
    createCad: {
      useMutation: (options) => ({
        isPending: false,
        mutate: (input) => {
          const model = {
            ...window.fixtureModels[0],
            id: input.id,
            seriesId: input.id,
            name: input.name,
            filename: "design.ifc",
          };
          window.fixtureModels.push(model);
          window.designSaved = blank;
          options.onSuccess(model);
        },
      }),
    },
    publication: noop,
    convert: noop,
    saveView: noop,
    removeView: noop,
    remove: noop,
    design: {
      useQuery: (input, opts) => {
        const [value, setValue] = useState(window.designSaved);
        return {
          data: opts.enabled ? value : undefined,
          refetch: async () => {
            setValue(window.designSaved);
            return { data: window.designSaved };
          },
        };
      },
    },
    designStatus: { useQuery: () => ({ data: { revision: window.designSaved.revision }, dataUpdatedAt: 0 }) },
    saveDesign: {
      useMutation: () => ({
        isPending: false,
        reset() {},
        mutate: (input, opts) => {
          window.designSaved = {
            revision: input.expectedRevision + 1,
            design: input.design,
            updatedAt: new Date().toISOString(),
            updatedBy: "test",
          };
          opts.onSuccess(window.designSaved);
        },
      }),
    },
  },
};
