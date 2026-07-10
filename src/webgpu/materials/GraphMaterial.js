import { Color, SRGBColorSpace, Vector2 } from 'three';
import { MeshBasicNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import { globalId, storage, uniform, uv, varying, wgslFn } from 'three/tsl';
import { wgslTagFn, wgslTagCode } from 'three-mesh-bvh/webgpu';
import { ComputeKernel } from '../compute/ComputeKernel.js';

// pastel palette evenly spaced along the color wheel, looped when there are more graphs
const GRAPH_COLOR_COUNT = 10;

export function getGraphColor( i ) {

	const hue = ( i % GRAPH_COLOR_COUNT ) / GRAPH_COLOR_COUNT;
	return new Color().setHSL( hue, 0.65, 0.7, SRGBColorSpace );

}

// anti-aliased background with x / y axes and 1-unit markers
const getBackgroundFunc = wgslFn( /* wgsl */`
	fn getBackground( point: vec2f, steepness: f32 ) -> vec3f {

		let pw = fwidth( point );
		let halfWidth = pw * 0.5;

		// x, y axes
		var distToZero = smoothstep(
			- halfWidth * 0.5,
			halfWidth * 0.5,
			abs( point ) - pw
		);

		// 1 unit markers
		let modAxis = fract( abs( point + vec2f( 0.5 ) ) ) - 0.5;
		var distToAxis = smoothstep(
			- halfWidth,
			halfWidth,
			abs( modAxis ) - pw * 0.5
		);

		// if we're at a chart boundary then remove the artifacts
		if ( abs( pw.y ) > steepness * 0.5 ) {

			distToZero.y = 1.0;
			distToAxis.y = 1.0;

		}

		// mix colors into a background color
		let axisIntensity = 1.0 - min( distToZero.x, distToZero.y );
		let markerIntensity = 1.0 - min( distToAxis.x, distToAxis.y );

		let markerColor = mix( vec3f( 0.005 ), vec3f( 0.05 ), markerIntensity );
		return mix( markerColor, vec3f( 0.2 ), axisIntensity );

	}
` );

// Fullscreen material that plots an arbitrary number of WGSL functions of the form
// "fn( x: f32 ) -> f32" provided via "setGraphs", either overlaid or in stacked sections.
export class GraphMaterial extends MeshBasicNodeMaterial {

	get dim() {

		return this._dim.value > 0.5;

	}

	set dim( v ) {

		this._dim.value = v ? 1 : 0;

	}

	get overlay() {

		return this._overlay.value > 0.5;

	}

	set overlay( v ) {

		this._overlay.value = v ? 1 : 0;

	}

	get thickness() {

		return this._thickness.value;

	}

	set thickness( v ) {

		this._thickness.value = v;

	}

	get xRange() {

		return this._xRange.value;

	}

	get yRange() {

		return this._yRange.value;

	}

	get graphCount() {

		return this._graphs.length;

	}

	// the mouse position in graph space - set to a distant point to hide the markers
	get mousePoint() {

		return this._mousePoint.value;

	}

	constructor( options = {} ) {

		const { graphs = [], ...params } = options;

		super();

		this.depthWrite = false;
		this.depthTest = false;

		// uniforms - created once and shared across shader rebuilds
		this._xRange = uniform( new Vector2( - 2, 2 ) );
		this._yRange = uniform( new Vector2( - 2, 2 ) );
		this._thickness = uniform( window.devicePixelRatio );
		this._dim = uniform( 1 );
		this._overlay = uniform( 1 );
		this._displayMask = uniform( 0xffffffff, 'uint' );
		this._mousePoint = uniform( new Vector2( 1e10, 1e10 ) );
		this._graphs = [];

		this.setGraphs( graphs );
		this.setValues( params );

	}

	// toggles the visibility of the graph at the given index
	setGraphVisible( index, visible ) {

		const mask = this._displayMask;
		if ( visible ) {

			mask.value = ( mask.value | ( 1 << index ) ) >>> 0;

		} else {

			mask.value = ( mask.value & ~ ( 1 << index ) ) >>> 0;

		}

	}

	getGraphVisible( index ) {

		return ( ( this._displayMask.value >> index ) & 1 ) === 1;

	}

	// Replaces the set of plotted functions - each an "fn( x: f32 ) -> f32" wgsl function node -
	// and rebuilds the shader to display them.
	setGraphs( graphs ) {

		const { _xRange, _yRange, _thickness, _dim, _overlay, _displayMask, _mousePoint } = this;

		this._graphs = [ ...graphs ];

		// unroll one evaluation block per graph, accumulated into a single code chunk
		let graphBody = wgslTagCode`// per-graph evaluation`;
		graphs.forEach( ( graph, i ) => {

			const color = getGraphColor( i );
			graphBody = wgslTagCode/* wgsl */`
				${ graphBody }

				{

					let delta = ${ graph }( point.x ) - point.y;
					var halfDdf = fwidth( delta ) * 0.5;
					if ( pointYWidth > yWidth * 0.5 ) {

						halfDdf = 0.0;

					}

					var graph = smoothstep( - halfDdf, halfDdf, abs( delta ) - ${ _thickness } * halfDdf );
					if ( dimmed ) {

						graph = mix( 1.0, graph, 0.1 );

					}

					let visible = ( ( displayMask >> ${ i }u ) & 1u ) == 1u;
					if ( visible && ( sectionCount < 1.5 || section == ${ i } ) ) {

						color = mix( vec3f( ${ color.r }, ${ color.g }, ${ color.b } ), color, graph );

						// circle marker at the mouse line's intersection with the curve
						let intersection = vec2f( mousePoint.x, ${ graph }( mousePoint.x ) );
						let circleDist = length( ( point - intersection ) / pw );
						let circle = smoothstep( 4.0, 5.0, circleDist );
						color = mix( vec3f( ${ color.r }, ${ color.g }, ${ color.b } ), color, circle );

					}

				}
			`;

		} );

		// the section math assumes at least one graph
		const count = Math.max( graphs.length, 1 );
		const graphShader = wgslTagFn/* wgsl */`
			fn graphShader( vUv: vec2f ) -> vec4f {

				var sectionCount = ${ count }.0;
				if ( ${ _overlay } > 0.5 ) {

					sectionCount = 1.0;

				}

				let yWidth = abs( ${ _yRange }.y - ${ _yRange }.x );

				// separate into sections
				let scaledY = sectionCount * vUv.y;
				let sectionY = fract( scaledY );
				let section = clamp( i32( sectionCount - floor( scaledY ) - 1.0 ), 0, ${ count - 1 } );

				// the graph-space point for this pixel
				let point = vec2f(
					mix( ${ _xRange }.x, ${ _xRange }.y, vUv.x ),
					mix( ${ _yRange }.x, ${ _yRange }.y, sectionY )
				);

				let pw = fwidth( point );
				let pointYWidth = pw.y;
				let dimmed = ${ _dim } > 0.5 && ( point.x < 0.0 || point.y < 0.0 );
				let displayMask = ${ _displayMask };
				let mousePoint = ${ _mousePoint };

				var color = ${ getBackgroundFunc }( point, yWidth );

				// vertical marker line at the mouse position
				let mouseLine = smoothstep( - pw.x * 0.5, pw.x * 0.5, abs( point.x - mousePoint.x ) - pw.x );
				color = mix( vec3f( 0.35 ), color, mouseLine );

				${ graphBody }

				return vec4f( color, 1.0 );

			}
		`;

		// NOTE: varyings cannot be referenced directly and must be passed as arguments
		this.colorNode = graphShader( varying( uv() ) );
		this.needsUpdate = true;

		// compute kernel that evaluates every graph at the mouse x so the values can be read back.
		// The buffer is padded to a minimum length of 2 to avoid TSL treating it as a scalar.
		const valuesAttribute = new StorageBufferAttribute( new Float32Array( Math.max( count, 2 ) ), 1 );
		const valuesStorage = storage( valuesAttribute, 'float' );

		let valuesBody = wgslTagCode`// per-graph values`;
		graphs.forEach( ( graph, i ) => {

			valuesBody = wgslTagCode/* wgsl */`
				${ valuesBody }
				${ valuesStorage }[ ${ i } ] = ${ graph }( x );
			`;

		} );

		const valuesFn = wgslTagFn/* wgsl */`
			fn computeGraphValues( globalId: vec3u ) -> void {

				let x = ${ _mousePoint }.x;
				${ valuesBody }

			}
		`;

		this._valuesAttribute = valuesAttribute;
		this._valuesKernel = new ComputeKernel( valuesFn( { globalId } ), { workgroupSize: [ 1, 1, 1 ] } );

	}

	// Evaluates every graph function at the current "mousePoint.x" on the gpu and resolves to a
	// Float32Array of the resulting values.
	async readGraphValues( renderer ) {

		const count = this._graphs.length;
		if ( count === 0 ) {

			return new Float32Array( 0 );

		}

		renderer.compute( this._valuesKernel.kernel, [ 1, 1, 1 ] );

		const buffer = await renderer.getArrayBufferAsync( this._valuesAttribute );
		return new Float32Array( buffer ).slice( 0, count );

	}

}
