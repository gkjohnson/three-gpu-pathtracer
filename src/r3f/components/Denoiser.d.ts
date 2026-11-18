import type {
	ReactNode,
	Context,
	RefAttributes,
	JSX,
} from 'react';

export declare const DenoiserContext: Context<any>;

interface DenoiserProps<
	Denoiser extends new ( ...args: any[] ) => void,
	Params extends any[] = ConstructorParameters<Denoiser>,
> {
	denoiser: Denoiser;
	args?: Params;
	children?: ReactNode;
	[key: string]: Params | Denoiser | any;
}

export declare const Denoiser: <
	Denoiser extends new ( ...args: any[] ) => void,
	Params extends any[] = ConstructorParameters<Denoiser>,
>(
	props: DenoiserProps<Denoiser, Params> & RefAttributes<Denoiser>,
) => JSX.Element;
