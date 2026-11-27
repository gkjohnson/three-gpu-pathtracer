import type {
	ReactNode,
	Context,
	JSX,
} from 'react';
import type { OIDNDenoiser } from '../../webgpu/index.js';

export declare const DenoiserContext: Context<OIDNDenoiser | null>;

interface DenoiserProps {
	denoiser: OIDNDenoiser;
	children?: ReactNode;
	[key: string]: any;
}

export declare const Denoiser: ( props: DenoiserProps ) => JSX.Element;
