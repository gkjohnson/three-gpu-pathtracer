import type {
	ReactNode,
	Context,
	RefAttributes,
	JSX,
} from 'react';

export declare const UpscalerContext: Context<any>;

interface UpscalerProps<
	Upscaler extends new ( ...args: any[] ) => void,
	Params extends any[] = ConstructorParameters<Upscaler>,
> {
	upscaler: Upscaler;
	args?: Params;
	children?: ReactNode;
	[key: string]: Params | Upscaler | any;
}

export declare const Upscaler: <
	Upscaler extends new ( ...args: any[] ) => void,
	Params extends any[] = ConstructorParameters<Upscaler>,
>(
	props: UpscalerProps<Upscaler, Params> & RefAttributes<Upscaler>,
) => JSX.Element;
