import type {
	ReactNode,
	Context,
	JSX,
} from 'react';
import type { FSRUpscaler } from '../../webgpu/index.js';

export declare const UpscalerContext: Context<FSRUpscaler | null>;

interface UpscalerProps {
	upscaler: FSRUpscaler;
	children?: ReactNode;
	[key: string]: any;
}

export declare const Upscaler: ( props: UpscalerProps ) => JSX.Element;
