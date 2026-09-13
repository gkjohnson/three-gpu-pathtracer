import { MeshBasicNodeMaterial, StorageTexture } from 'three/webgpu';
import { texture, uniform, uv, varying, vec4, wgslFn } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';

const sampleTexel = wgslFn( /* wgsl */`
	fn sampleTexel( tex: texture_2d<f32>, coord: vec2f ) -> vec4f {

		let size = vec2f( textureDimensions( tex, 0 ) );

		// the path tracer stores its color rows top down, so v of 0 is the last texel row
		let pxCoord = vec2f( coord.x, 1.0 - coord.y ) * size - 0.5;
		let px = vec2i( floor( pxCoord ) );
		let fr = fract( pxCoord );
		let maxPx = vec2i( size ) - 1;

		let s00 = textureLoad( tex, clamp( px, vec2i( 0 ), maxPx ), 0 );
		let s10 = textureLoad( tex, clamp( px + vec2i( 1, 0 ), vec2i( 0 ), maxPx ), 0 );
		let s01 = textureLoad( tex, clamp( px + vec2i( 0, 1 ), vec2i( 0 ), maxPx ), 0 );
		let s11 = textureLoad( tex, clamp( px + vec2i( 1, 1 ), vec2i( 0 ), maxPx ), 0 );

		return mix( mix( s00, s10, fr.x ), mix( s01, s11, fr.x ), fr.y );

	}
` );

export class QuiltPreviewNodeMaterial extends MeshBasicNodeMaterial {

	get quiltMap() {

		return this._quiltMap.value;

	}

	set quiltMap( value ) {

		this._quiltMap.value = value;

	}

	get quiltDimensions() {

		return this._quiltDimensions.value;

	}

	set quiltDimensions( value ) {

		this._quiltDimensions.value.copy( value );

	}

	get displayIndex() {

		return this._displayIndex.value;

	}

	set displayIndex( value ) {

		this._displayIndex.value = value;

	}

	get aspectRatio() {

		return this._aspectRatio.value;

	}

	set aspectRatio( value ) {

		this._aspectRatio.value = value;

	}

	get heightScale() {

		return this._heightScale.value;

	}

	set heightScale( value ) {

		this._heightScale.value = value;

	}

	constructor( parameters = {} ) {

		super();

		const quiltMap = texture( new StorageTexture() );
		const quiltDimensions = uniform( parameters.quiltDimensions.clone() );
		const displayIndex = uniform( - 1, 'int' );
		const aspectRatio = uniform( 1 );
		const heightScale = uniform( 1 );

		this._quiltMap = quiltMap;
		this._quiltDimensions = quiltDimensions;
		this._displayIndex = displayIndex;
		this._aspectRatio = aspectRatio;
		this._heightScale = heightScale;

		const getColor = wgslTagFn/* wgsl */`
			fn getColor( uv: vec2f ) -> vec4f {

				// the corner radius is measured in panel heights
				let CORNER_RADIUS = 0.02;
				let MATTE_COLOR = vec4f( 0.015, 0.015, 0.015, 1.0 );

				if ( ${ displayIndex } < 0 ) {

					return ${ sampleTexel }( ${ quiltMap }, uv );

				}

				var tileUv = uv;
				tileUv.x -= ( 1.0 - ${ aspectRatio } * ${ heightScale } ) * 0.5;
				tileUv.x /= ${ aspectRatio };
				tileUv.y -= ( 1.0 - ${ heightScale } ) * 0.5;
				tileUv /= ${ heightScale };

				// Distance to the rounded edge of the panel. The x axis is scaled by the aspect
				// ratio so the corners come out circular rather than elliptical, which leaves the
				// radius measured in panel heights.
				let scale = vec2f( ${ aspectRatio }, 1.0 );
				let corner = abs( ( tileUv - 0.5 ) * scale ) - scale * 0.5 + CORNER_RADIUS;
				let dist = length( max( corner, vec2f( 0.0 ) ) ) + min( max( corner.x, corner.y ), 0.0 ) - CORNER_RADIUS;

				let size = vec2f( textureDimensions( ${ quiltMap }, 0 ) );
				let tileTexelHalfWidth = 0.5 * ${ quiltDimensions } / size;
				tileUv = clamp( tileUv, tileTexelHalfWidth, 1.0 - tileTexelHalfWidth );

				let columns = i32( ${ quiltDimensions }.x );
				let tileIndex = vec2f(
					f32( ${ displayIndex } % columns ),
					f32( ${ displayIndex } / columns )
				);
				let quiltUv = ( tileIndex + tileUv ) / ${ quiltDimensions };
				let color = ${ sampleTexel }( ${ quiltMap }, quiltUv );

				// fade across a single pixel of the edge so the corners are not jagged
				let aa = fwidth( dist );
				return mix( color, MATTE_COLOR, smoothstep( - aa, aa, dist ) );

			}
		`;

		this.depthTest = false;
		this.depthWrite = false;
		this.colorNode = vec4( getColor( varying( uv() ) ) );

		this.setValues( parameters );

	}

}
