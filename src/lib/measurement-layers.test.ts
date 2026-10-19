import {describe,it,expect} from 'vitest';
import {measurementLayerNames,measurementLayerVisible} from './measurement-layers';
describe('measurement layers',()=>{
 it('reads older single-layer measurements and General defaults',()=>{
  expect(measurementLayerNames({layer:'Plumbing'})).toEqual(['Plumbing']);
  expect(measurementLayerNames({})).toEqual(['General']);
 });
 it('shows a multi-layer measurement if any assigned layer is visible',()=>{
  const data={layer:'Plumbing',layers:['Plumbing','Cold water']};
  expect(measurementLayerVisible(data,['Plumbing'])).toBe(true);
  expect(measurementLayerVisible(data,['Plumbing','Cold water'])).toBe(false);
 });
});
