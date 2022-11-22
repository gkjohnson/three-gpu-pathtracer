import { Color } from 'three';
import { ProceduralEquirectTexture } from './ProceduralEquirectTexture.js';

export class GradientEquirectTexture extends ProceduralEquirectTexture {

	constructor( topColor = 0xffffff, bottomColor = 0, resolution = 512 ) {

		super( 1, resolution );

		this.topColor = new Color().set( topColor );
		this.bottomColor = new Color().set( bottomColor );
		this.generationCallback = ( polar, uv, coord, color ) => {

			color.lerpColors( this.bottomColor, this.topColor, uv.y );

		};

	}

}
