import {
	ClampToEdgeWrapping,
	HalfFloatType,
} from 'three';
import { RenderTarget2DArray } from './RenderTarget2DArray.js';

export class IESProfilesTexture extends RenderTarget2DArray {

	constructor( width, height, depth, options ) {

		super( width, height, depth, {
			type: HalfFloatType,
			wrapS: ClampToEdgeWrapping,
			wrapT: ClampToEdgeWrapping,
			...options,
		} );

	}

	updateFrom( renderer, textures ) {

		this.setTextures( renderer, this.width, this.height, textures );

	}

	dispose() {

		super.dispose();
		this.fsQuad.dispose();

	}

}
