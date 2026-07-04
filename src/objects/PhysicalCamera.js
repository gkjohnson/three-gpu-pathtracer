import { PerspectiveCamera, Matrix4, WebGPUCoordinateSystem } from 'three';
import { uniform } from 'three/tsl';
import { wgslTagFn, rayStruct, ndcToCameraRay } from '../../../three-mesh-bvh/src/webgpu/index.js';
import { rand3, RNG_INDEX_APERTURE_SAMPLE } from '../webgpu/nodes/random.wgsl.js';

// aperture sampling helpers, ported from the WebGL path tracer's shape / camera utilities
const sampleCircle = wgslTagFn/* wgsl */`
	fn sampleCircle( uv: vec2f ) -> vec2f {

		let PI = 3.141592653589793;
		let angle = 2.0 * PI * uv.x;
		let radius = sqrt( uv.y );
		return vec2f( cos( angle ), sin( angle ) ) * radius;

	}
`;

const sampleTriangle = wgslTagFn/* wgsl */`
	fn sampleTriangle( a: vec2f, b: vec2f, c: vec2f, rIn: vec2f ) -> vec2f {

		let e1 = a - b;
		let e2 = c - b;

		var r = rIn;
		if ( r.x + r.y > 1.0 ) {

			r = vec2f( 1.0 ) - r;

		}

		return e1 * r.x + e2 * r.y;

	}
`;

const sampleRegularPolygon = wgslTagFn/* wgsl */`
	fn sampleRegularPolygon( sidesIn: i32, uvw: vec3f ) -> vec2f {

		let PI = 3.141592653589793;
		let sides = max( sidesIn, 3 );
		let anglePerSegment = 2.0 * PI / f32( sides );
		let segment = floor( f32( sides ) * uvw.x );

		let angle1 = anglePerSegment * segment;
		let angle2 = angle1 + anglePerSegment;
		let a = vec2f( sin( angle1 ), cos( angle1 ) );
		let b = vec2f( 0.0, 0.0 );
		let c = vec2f( sin( angle2 ), cos( angle2 ) );

		return ${ sampleTriangle }( a, b, c, uvw.yz );

	}
`;

// samples an aperture shape with the given number of blades. 0 means circle
const sampleAperture = wgslTagFn/* wgsl */`
	fn sampleAperture( blades: i32, uvw: vec3f ) -> vec2f {

		if ( blades == 0 ) {

			return ${ sampleCircle }( uvw.xy );

		}

		return ${ sampleRegularPolygon }( blades, uvw );

	}
`;

const rotateVector = wgslTagFn/* wgsl */`
	fn rotateVector( v: vec2f, t: f32 ) -> vec2f {

		let vc = cos( t );
		let vs = sin( t );
		return vec2f( v.x * vc - v.y * vs, v.x * vs + v.y * vc );

	}
`;

export class PhysicalCamera extends PerspectiveCamera {

	set bokehSize( size ) {

		this.fStop = this.getFocalLength() / size;

	}

	get bokehSize() {

		return this.getFocalLength() / this.fStop;

	}

	constructor( ...args ) {

		super( ...args );
		this.fStop = 1.4;
		this.apertureBlades = 0;
		this.apertureRotation = 0;
		this.focusDistance = 25;
		this.anamorphicRatio = 1;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		this.fStop = source.fStop;
		this.apertureBlades = source.apertureBlades;
		this.apertureRotation = source.apertureRotation;
		this.focusDistance = source.focusDistance;
		this.anamorphicRatio = source.anamorphicRatio;

		return this;

	}

	getCameraRayFn() {

		// premultiplied inverse view-projection ( world * inverseProjection ) for the base perspective ray,
		// plus the world matrix to orient the aperture offset. the remaining fields drive the bokeh shape.
		const invViewProjectionMatrix = uniform( new Matrix4() );
		const cameraWorldMatrix = uniform( new Matrix4() );
		const focusDistance = uniform( 0 );
		const bokehSize = uniform( 0 );
		const apertureBlades = uniform( 0, 'int' );
		const apertureRotation = uniform( 0 );
		const anamorphicRatio = uniform( 1 );

		const fn = wgslTagFn/* wgsl */`
			fn getCameraRay( uv: vec2f, resolution: vec2f ) -> ${ rayStruct } {

				// base perspective ray from the premultiplied inverse view-projection matrix
				let ndc = uv * 2.0 - vec2f( 1.0 );
				var ray = ${ ndcToCameraRay }( ndc, ${ invViewProjectionMatrix } );

				// depth of field - offset the origin across the aperture and re-aim at the focal point
				let focalPoint = ray.origin + normalize( ray.direction ) * ${ focusDistance };

				// sample the aperture shape ( blades == 0 is treated as a circle )
				// bokehSize is in millimeters, so scale to world units ( radius = diameter * 0.5 )
				let shapeUVW = ${ rand3 }( ${ RNG_INDEX_APERTURE_SAMPLE } );
				var apertureSample = ${ sampleAperture }( ${ apertureBlades }, shapeUVW );
				apertureSample *= ${ bokehSize } * 0.5 * 1e-3;

				// rotate + squash the sample for anamorphic apertures
				apertureSample = ${ rotateVector }( apertureSample, ${ apertureRotation } )
					* clamp( vec2f( ${ anamorphicRatio }, 1.0 / ${ anamorphicRatio } ), vec2f( 0.0 ), vec2f( 1.0 ) );

				ray.origin += ( ${ cameraWorldMatrix } * vec4f( apertureSample, 0.0, 0.0 ) ).xyz;
				ray.direction = focalPoint - ray.origin;

				return ray;

			}
		`;

		const update = () => {

			this.coordinateSystem = WebGPUCoordinateSystem;
			this.updateMatrixWorld();
			this.updateProjectionMatrix();

			invViewProjectionMatrix.value.multiplyMatrices( this.matrixWorld, this.projectionMatrixInverse );
			cameraWorldMatrix.value.copy( this.matrixWorld );

			focusDistance.value = this.focusDistance;
			bokehSize.value = this.bokehSize;
			apertureBlades.value = this.apertureBlades;
			apertureRotation.value = this.apertureRotation;
			anamorphicRatio.value = this.anamorphicRatio;

		};

		return { fn, update };

	}

}
