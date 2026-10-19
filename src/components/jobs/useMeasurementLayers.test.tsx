import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useMeasurementLayers} from './useMeasurementLayers';
const identity=vi.hoisted(()=>({account:{accountKey:'first'}}));
vi.mock('./DrawingAccountProvider',()=>({useDrawingAccount:()=>identity.account}));
function Picker({sheet='one'}:{sheet?:string}){const [value,set]=useMeasurementLayers(sheet);return <button onClick={()=>set(['Plumbing','Cold water'])}>{value.join(', ')}</button>}
beforeEach(()=>{identity.account={accountKey:'first'};const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)});});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('remembers selected layers after reopening, independently for each user and sheet',()=>{
 const view=render(<Picker/>);fireEvent.click(screen.getByRole('button'));view.unmount();
 const next=render(<Picker/>);expect(screen.getByRole('button')).toHaveTextContent('Plumbing, Cold water');
 next.rerender(<Picker sheet="two"/>);expect(screen.getByRole('button')).toHaveTextContent('General');
 identity.account={accountKey:'second'};next.rerender(<Picker/>);expect(screen.getByRole('button')).toHaveTextContent('General');
});
