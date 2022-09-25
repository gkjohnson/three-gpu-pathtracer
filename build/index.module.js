import { ShaderMaterial, NoBlending, NormalBlending, Color, Vector2, WebGLRenderTarget, RGBAFormat, FloatType, BufferAttribute, Mesh, BufferGeometry, PerspectiveCamera, DataTexture, ClampToEdgeWrapping, DoubleSide, BackSide, FrontSide, Matrix3, WebGLArrayRenderTarget, UnsignedByteType, LinearFilter, RepeatWrapping, MeshBasicMaterial, NoToneMapping, Source, HalfFloatType, DataUtils, RedFormat, PMREMGenerator, EquirectangularReflectionMapping, Matrix4 } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { StaticGeometryGenerator, SAH, MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture, UIntVertexAttributeTexture, shaderStructs, shaderIntersectFunction } from 'three-mesh-bvh';
import { mergeVertices, mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

class MaterialBase extends ShaderMaterial {

	constructor( shader ) {

		super( shader );

		for ( const key in this.uniforms ) {

			Object.defineProperty( this, key, {

				get() {

					return this.uniforms[ key ].value;

				},

				set( v ) {

					this.uniforms[ key ].value = v;

				}

			} );

		}

	}

	// sets the given named define value and sets "needsUpdate" to true if it's different
	setDefine( name, value = undefined ) {

		if ( value === undefined || value === null ) {

			if ( name in this.defines ) {

				delete this.defines[ name ];
				this.needsUpdate = true;

			}

		} else {

			if ( this.defines[ name ] !== value ) {

				this.defines[ name ] = value;
				this.needsUpdate = true;

			}

		}

	}

}

class BlendMaterial extends MaterialBase {

	constructor( parameters ) {

		super( {

			blending: NoBlending,

			uniforms: {

				target1: { value: null },
				target2: { value: null },
				opacity: { value: 1.0 },

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,

			fragmentShader: /* glsl */`

				uniform float opacity;

				uniform sampler2D target1;
				uniform sampler2D target2;

				varying vec2 vUv;

				void main() {

					vec4 color1 = texture2D( target1, vUv );
					vec4 color2 = texture2D( target2, vUv );

					float invOpacity = 1.0 - opacity;
					float totalAlpha = color1.a * invOpacity + color2.a * opacity;

					if ( color1.a != 0.0 || color2.a != 0.0 ) {

						gl_FragColor.rgb = color1.rgb * ( invOpacity * color1.a / totalAlpha ) + color2.rgb * ( opacity * color2.a / totalAlpha );
						gl_FragColor.a = totalAlpha;

					} else {

						gl_FragColor = vec4( 0.0 );

					}

				}`

		} );

		this.setValues( parameters );

	}

}

function* renderTask() {

	const {
		_renderer,
		_fsQuad,
		_blendQuad,
		_primaryTarget,
		_blendTargets,
		alpha,
		camera,
		material,
	} = this;

	const blendMaterial = _blendQuad.material;
	let [ blendTarget1, blendTarget2 ] = _blendTargets;

	while ( true ) {

		if ( alpha ) {

			blendMaterial.opacity = 1 / ( this.samples + 1 );
			material.blending = NoBlending;
			material.opacity = 1;

		} else {

			material.opacity = 1 / ( this.samples + 1 );
			material.blending = NormalBlending;

		}

		const w = _primaryTarget.width;
		const h = _primaryTarget.height;
		material.resolution.set( w, h );
		material.seed ++;

		const tx = this.tiles.x || 1;
		const ty = this.tiles.y || 1;
		const totalTiles = tx * ty;
		const dprInv = ( 1 / _renderer.getPixelRatio() );
		for ( let y = 0; y < ty; y ++ ) {

			for ( let x = 0; x < tx; x ++ ) {

				material.cameraWorldMatrix.copy( camera.matrixWorld );
				material.invProjectionMatrix.copy( camera.projectionMatrixInverse );

				const ogRenderTarget = _renderer.getRenderTarget();
				const ogAutoClear = _renderer.autoClear;

				// three.js renderer takes values relative to the current pixel ratio
				_renderer.setRenderTarget( _primaryTarget );
				_renderer.setScissorTest( true );
				_renderer.setScissor(
					dprInv * Math.ceil( x * w / tx ),
					dprInv * Math.ceil( ( ty - y - 1 ) * h / ty ),
					dprInv * Math.ceil( w / tx ),
					dprInv * Math.ceil( h / ty ) );
				_renderer.autoClear = false;
				_fsQuad.render( _renderer );

				_renderer.setScissorTest( false );
				_renderer.setRenderTarget( ogRenderTarget );
				_renderer.autoClear = ogAutoClear;

				if ( alpha ) {

					blendMaterial.target1 = blendTarget1.texture;
					blendMaterial.target2 = _primaryTarget.texture;

					_renderer.setRenderTarget( blendTarget2 );
					_blendQuad.render( _renderer );
					_renderer.setRenderTarget( ogRenderTarget );

				}

				this.samples += ( 1 / totalTiles );

				yield;

			}

		}

		[ blendTarget1, blendTarget2 ] = [ blendTarget2, blendTarget1 ];

		this.samples = Math.round( this.samples );

	}

}

const ogClearColor = new Color();
class PathTracingRenderer {

	get material() {

		return this._fsQuad.material;

	}

	set material( v ) {

		this._fsQuad.material = v;

	}

	get target() {

		return this._alpha ? this._blendTargets[ 1 ] : this._primaryTarget;

	}

	set alpha( v ) {

		if ( ! v ) {

			this._blendTargets[ 0 ].dispose();
			this._blendTargets[ 1 ].dispose();

		}

		this._alpha = v;
		this.reset();

	}

	get alpha() {

		return this._alpha;

	}

	constructor( renderer ) {

		this.camera = null;
		this.tiles = new Vector2( 1, 1 );

		this.samples = 0;
		this.stableNoise = false;
		this._renderer = renderer;
		this._alpha = false;
		this._fsQuad = new FullScreenQuad( null );
		this._blendQuad = new FullScreenQuad( new BlendMaterial() );
		this._task = null;

		this._primaryTarget = new WebGLRenderTarget( 1, 1, {
			format: RGBAFormat,
			type: FloatType,
		} );
		this._blendTargets = [
			new WebGLRenderTarget( 1, 1, {
				format: RGBAFormat,
				type: FloatType,
			} ),
			new WebGLRenderTarget( 1, 1, {
				format: RGBAFormat,
				type: FloatType,
			} ),
		];

	}

	setSize( w, h ) {

		this._primaryTarget.setSize( w, h );
		this._blendTargets[ 0 ].setSize( w, h );
		this._blendTargets[ 1 ].setSize( w, h );
		this.reset();

	}

	dispose() {

		this._primaryTarget.dispose();
		this._blendTargets[ 0 ].dispose();
		this._blendTargets[ 1 ].dispose();

		this._fsQuad.dispose();
		this._blendQuad.dispose();
		this._task = null;

	}

	reset() {

		const { _renderer, _primaryTarget, _blendTargets } = this;
		const ogRenderTarget = _renderer.getRenderTarget();
		const ogClearAlpha = _renderer.getClearAlpha();
		_renderer.getClearColor( ogClearColor );

		_renderer.setRenderTarget( _primaryTarget );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

		_renderer.setRenderTarget( _blendTargets[ 0 ] );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

		_renderer.setRenderTarget( _blendTargets[ 1 ] );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

		_renderer.setClearColor( ogClearColor, ogClearAlpha );
		_renderer.setRenderTarget( ogRenderTarget );

		this.samples = 0;
		this._task = null;

		if ( this.stableNoise ) {

			this.material.seed = 0;

		}

	}

	update() {

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

}

function getGroupMaterialIndicesAttribute( geometry, materials, allMaterials ) {

	const indexAttr = geometry.index;
	const posAttr = geometry.attributes.position;
	const vertCount = posAttr.count;
	const materialArray = new Uint8Array( vertCount );
	const totalCount = indexAttr ? indexAttr.count : vertCount;
	let groups = geometry.groups;
	if ( groups.length === 0 ) {

		groups = [ { count: totalCount, start: 0, materialIndex: 0 } ];

	}

	for ( let i = 0; i < groups.length; i ++ ) {

		const group = groups[ i ];
		const start = group.start;
		const count = group.count;
		const endCount = Math.min( count, totalCount - start );

		const mat = Array.isArray( materials ) ? materials[ group.materialIndex ] : materials;
		const materialIndex = allMaterials.indexOf( mat );

		for ( let j = 0; j < endCount; j ++ ) {

			let index = start + j;
			if ( indexAttr ) {

				index = indexAttr.getX( index );

			}

			materialArray[ index ] = materialIndex;

		}

	}

	return new BufferAttribute( materialArray, 1, false );

}

function trimToAttributes( geometry, attributes ) {

	// trim any unneeded attributes
	if ( attributes ) {

		for ( const key in geometry.attributes ) {

			if ( ! attributes.includes( key ) ) {

				geometry.deleteAttribute( key );

			}

		}

	}

}

function setCommonAttributes( geometry, options ) {

	const { attributes = [], normalMapRequired = false } = options;

	if ( ! geometry.attributes.normal && ( attributes && attributes.includes( 'normal' ) ) ) {

		geometry.computeVertexNormals();

	}

	if ( ! geometry.attributes.uv && ( attributes && attributes.includes( 'uv' ) ) ) {

		const vertCount = geometry.attributes.position.count;
		geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( vertCount * 2 ), 2, false ) );

	}

	if ( ! geometry.attributes.tangent && ( attributes && attributes.includes( 'tangent' ) ) ) {

		if ( normalMapRequired ) {

			// computeTangents requires an index buffer
			if ( geometry.index === null ) {

				geometry = mergeVertices( geometry );

			}

			geometry.computeTangents();

		} else {

			const vertCount = geometry.attributes.position.count;
			geometry.setAttribute( 'tangent', new BufferAttribute( new Float32Array( vertCount * 4 ), 4, false ) );

		}

	}

	if ( ! geometry.index ) {

		// TODO: compute a typed array
		const indexCount = geometry.attributes.position.count;
		const array = new Array( indexCount );
		for ( let i = 0; i < indexCount; i ++ ) {

			array[ i ] = i;

		}

		geometry.setIndex( array );

	}

}

function mergeMeshes( meshes, options = {} ) {

	options = { attributes: null, cloneGeometry: true, ...options };

	const transformedGeometry = [];
	const materialSet = new Set();
	for ( let i = 0, l = meshes.length; i < l; i ++ ) {

		// save any materials
		const mesh = meshes[ i ];
		if ( mesh.visible === false ) continue;

		if ( Array.isArray( mesh.material ) ) {

			mesh.material.forEach( m => materialSet.add( m ) );

		} else {

			materialSet.add( mesh.material );

		}

	}

	const materials = Array.from( materialSet );
	for ( let i = 0, l = meshes.length; i < l; i ++ ) {

		// ensure the matrix world is up to date
		const mesh = meshes[ i ];
		if ( mesh.visible === false ) continue;

		mesh.updateMatrixWorld();

		// apply the matrix world to the geometry
		const originalGeometry = meshes[ i ].geometry;
		let geometry = options.cloneGeometry ? originalGeometry.clone() : originalGeometry;
		geometry.applyMatrix4( mesh.matrixWorld );

		// ensure our geometry has common attributes
		setCommonAttributes( geometry, {
			attributes: options.attributes,
			normalMapRequired: ! ! mesh.material.normalMap,
		} );
		trimToAttributes( geometry, options.attributes );

		// create the material index attribute
		const materialIndexAttribute = getGroupMaterialIndicesAttribute( geometry, mesh.material, materials );
		geometry.setAttribute( 'materialIndex', materialIndexAttribute );

		transformedGeometry.push( geometry );

	}

	const textureSet = new Set();
	materials.forEach( material => {

		for ( const key in material ) {

			const value = material[ key ];
			if ( value && value.isTexture ) {

				textureSet.add( value );

			}

		}

	} );

	const geometry = mergeBufferGeometries( transformedGeometry, false );
	const textures = Array.from( textureSet );
	return { geometry, materials, textures };

}

class PathTracingSceneGenerator {

	prepScene( scene ) {

		const meshes = [];
		scene.traverse( c => {

			if ( c.isSkinnedMesh || c.isMesh && c.morphTargetInfluences ) {

				const generator = new StaticGeometryGenerator( c );
				generator.applyWorldTransforms = false;
				const mesh = new Mesh(
					generator.generate(),
					c.material,
				);
				mesh.matrixWorld.copy( c.matrixWorld );
				mesh.matrix.copy( c.matrixWorld );
				mesh.matrix.decompose( mesh.position, mesh.quaternion, mesh.scale );
				meshes.push( mesh );

			} else if ( c.isMesh ) {

				meshes.push( c );

			}

		} );

		return mergeMeshes( meshes, {
			attributes: [ 'position', 'normal', 'tangent', 'uv' ],
		} );

	}

	generate( scene, options = {} ) {

		const { materials, textures, geometry } = this.prepScene( scene );
		const bvhOptions = { strategy: SAH, ...options, maxLeafTris: 1 };
		return {
			scene,
			materials,
			textures,
			bvh: new MeshBVH( geometry, bvhOptions ),
		};

	}

}

class DynamicPathTracingSceneGenerator {

	get initialized() {

		return Boolean( this.bvh );

	}

	constructor( scene ) {

		this.scene = scene;
		this.bvh = null;
		this.geometry = new BufferGeometry();
		this.materials = null;
		this.textures = null;
		this.staticGeometryGenerator = new StaticGeometryGenerator( scene );

	}

	reset() {

		this.bvh = null;
		this.geometry.dispose();
		this.geometry = new BufferGeometry();
		this.materials = null;
		this.textures = null;
		this.staticGeometryGenerator = new StaticGeometryGenerator( this.scene );

	}

	dispose() {}

	generate() {

		const { scene, staticGeometryGenerator, geometry } = this;
		if ( this.bvh === null ) {

			const attributes = [ 'position', 'normal', 'tangent', 'uv' ];
			scene.traverse( c => {

				if ( c.isMesh ) {

					const normalMapRequired = ! ! c.material.normalMap;
					setCommonAttributes( c.geometry, { attributes, normalMapRequired } );

				}

			} );

			const textureSet = new Set();
			const materials = staticGeometryGenerator.getMaterials();
			materials.forEach( material => {

				for ( const key in material ) {

					const value = material[ key ];
					if ( value && value.isTexture ) {

						textureSet.add( value );

					}

				}

			} );

			staticGeometryGenerator.attributes = attributes;
			staticGeometryGenerator.generate( geometry );

			const materialIndexAttribute = getGroupMaterialIndicesAttribute( geometry, materials, materials );
			geometry.setAttribute( 'materialIndex', materialIndexAttribute );
			geometry.clearGroups();

			this.bvh = new MeshBVH( geometry );
			this.materials = materials;
			this.textures = Array.from( textureSet );

			return {
				bvh: this.bvh,
				materials: this.materials,
				textures: this.textures,
				scene,
			};

		} else {

			const { bvh } = this;
			staticGeometryGenerator.generate( geometry );
			bvh.refit();
			return {
				bvh: this.bvh,
				materials: this.materials,
				textures: this.textures,
				scene,
			};

		}

	}


}

// https://github.com/gkjohnson/webxr-sandbox/blob/main/skinned-mesh-batching/src/MaterialReducer.js

function isTypedArray( arr ) {

	return arr.buffer instanceof ArrayBuffer && 'BYTES_PER_ELEMENT' in arr;

}

class MaterialReducer {

	constructor() {

		const ignoreKeys = new Set();
		ignoreKeys.add( 'uuid' );

		this.ignoreKeys = ignoreKeys;
		this.shareTextures = true;
		this.textures = [];
		this.materials = [];

	}

	areEqual( objectA, objectB ) {

		const keySet = new Set();
		const traverseSet = new Set();
		const ignoreKeys = this.ignoreKeys;

		const traverse = ( a, b ) => {

			if ( a === b ) {

				return true;

			}

			if ( a && b && a instanceof Object && b instanceof Object ) {

				if ( traverseSet.has( a ) || traverseSet.has( b ) ) {

					throw new Error( 'MaterialReducer: Material is recursive.' );

				}

				const aIsElement = a instanceof Element;
				const bIsElement = b instanceof Element;
				if ( aIsElement || bIsElement ) {

					if ( aIsElement !== bIsElement || ! ( a instanceof Image ) || ! ( b instanceof Image ) ) {

						return false;

					}

					return a.src === b.src;

				}

				const aIsImageBitmap = a instanceof ImageBitmap;
				const bIsImageBitmap = b instanceof ImageBitmap;
				if ( aIsImageBitmap || bIsImageBitmap ) {

					return false;

				}

				if ( a.equals ) {

					return a.equals( b );

				}

				const aIsTypedArray = isTypedArray( a );
				const bIsTypedArray = isTypedArray( b );
				if ( aIsTypedArray || bIsTypedArray ) {

					if ( aIsTypedArray !== bIsTypedArray || a.constructor !== b.constructor || a.length !== b.length ) {

						return false;

					}

					for ( let i = 0, l = a.length; i < l; i ++ ) {

						if ( a[ i ] !== b[ i ] ) return false;

					}

					return true;

				}

				traverseSet.add( a );
				traverseSet.add( b );

				keySet.clear();
				for ( const key in a ) {

					if ( ! a.hasOwnProperty( key ) || a[ key ] instanceof Function || ignoreKeys.has( key ) ) {

						continue;

					}

					keySet.add( key );

				}

				for ( const key in b ) {

					if ( ! b.hasOwnProperty( key ) || b[ key ] instanceof Function || ignoreKeys.has( key ) ) {

						continue;

					}

					keySet.add( key );

				}

				const keys = Array.from( keySet.values() );
				let result = true;
				for ( const i in keys ) {

					const key = keys[ i ];
					if ( ignoreKeys.has( key ) ) {

						continue;

					}

					result = traverse( a[ key ], b[ key ] );
					if ( ! result ) {

						break;

					}

				}

				traverseSet.delete( a );
				traverseSet.delete( b );
				return result;

			}

			return false;

		};

		return traverse( objectA, objectB );

	}

	process( object ) {

		const { textures, materials } = this;
		let replaced = 0;

		const processMaterial = material => {

			// Check if another material matches this one
			let foundMaterial = null;
			for ( const i in materials ) {

				const otherMaterial = materials[ i ];
				if ( this.areEqual( material, otherMaterial ) ) {

					foundMaterial = otherMaterial;

				}

			}

			if ( foundMaterial ) {

				replaced ++;
				return foundMaterial;

			} else {

				materials.push( material );

				if ( this.shareTextures ) {

					// See if there's another texture that matches the ones on this material
					for ( const key in material ) {

						if ( ! material.hasOwnProperty( key ) ) continue;

						const value = material[ key ];
						if ( value && value.isTexture && value.image instanceof Image ) {

							let foundTexture = null;
							for ( const i in textures ) {

								const texture = textures[ i ];
								if ( this.areEqual( texture, value ) ) {

									foundTexture = texture;
									break;

								}

							}

							if ( foundTexture ) {

								material[ key ] = foundTexture;

							} else {

								textures.push( value );

							}

						}

					}

				}

				return material;

			}

		};

		object.traverse( c => {

			if ( c.isMesh && c.material ) {

				const material = c.material;
				if ( Array.isArray( material ) ) {

					for ( let i = 0; i < material.length; i ++ ) {

						material[ i ] = processMaterial( material[ i ] );

					}

				} else {

					c.material = processMaterial( material );

				}

			}

		} );

		return { replaced, retained: materials.length };

	}

}

class PhysicalCamera extends PerspectiveCamera {

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

}

const MATERIAL_PIXELS = 9;
const MATERIAL_STRIDE = MATERIAL_PIXELS * 4;

class MaterialsTexture extends DataTexture {

	constructor() {

		super( new Float32Array( 4 ), 1, 1 );

		this.format = RGBAFormat;
		this.type = FloatType;
		this.wrapS = ClampToEdgeWrapping;
		this.wrapT = ClampToEdgeWrapping;
		this.generateMipmaps = false;

	}

	setCastShadow( materialIndex, cast ) {

		// invert the shadow value so we default to "true" when initializing a material
		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 6 * 4 + 0;
		array[ index ] = ! cast ? 1 : 0;

	}

	getCastShadow( materialIndex ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 6 * 4 + 0;
		return ! Boolean( array[ index ] );

	}

	setSide( materialIndex, side ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 2;
		switch ( side ) {

			case FrontSide:
				array[ index ] = 1;
				break;
			case BackSide:
				array[ index ] = - 1;
				break;
			case DoubleSide:
				array[ index ] = 0;
				break;

		}

	}

	getSide( materialIndex ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 2;
		switch ( array[ index ] ) {

			case 0:
				return DoubleSide;
			case 1:
				return FrontSide;
			case - 1:
				return BackSide;

		}

		return 0;

	}

	setMatte( materialIndex, matte ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 3;
		array[ index ] = matte ? 1 : 0;

	}

	getMatte( materialIndex ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 3;
		return Boolean( array[ index ] );

	}

	updateFrom( materials, textures ) {

		function getTexture( material, key, def = - 1 ) {

			return key in material ? textures.indexOf( material[ key ] ) : def;

		}

		function getField( material, key, def ) {

			return key in material ? material[ key ] : def;

		}

		let index = 0;
		const pixelCount = materials.length * MATERIAL_PIXELS;
		const dimension = Math.ceil( Math.sqrt( pixelCount ) );

		if ( this.image.width !== dimension ) {

			this.dispose();

			this.image.data = new Float32Array( dimension * dimension * 4 );
			this.image.width = dimension;
			this.image.height = dimension;

		}

		const floatArray = this.image.data;

		// on some devices (Google Pixel 6) the "floatBitsToInt" function does not work correctly so we
		// can't encode texture ids that way.
		// const intArray = new Int32Array( floatArray.buffer );

		for ( let i = 0, l = materials.length; i < l; i ++ ) {

			const m = materials[ i ];

			// color
			floatArray[ index ++ ] = m.color.r;
			floatArray[ index ++ ] = m.color.g;
			floatArray[ index ++ ] = m.color.b;
			floatArray[ index ++ ] = getTexture( m, 'map' );

			// metalness & roughness
			floatArray[ index ++ ] = getField( m, 'metalness', 0.0 );
			floatArray[ index ++ ] = textures.indexOf( m.metalnessMap );
			floatArray[ index ++ ] = getField( m, 'roughness', 0.0 );
			floatArray[ index ++ ] = textures.indexOf( m.roughnessMap );

			// transmission & emissiveIntensity
			floatArray[ index ++ ] = getField( m, 'ior', 1.0 );
			floatArray[ index ++ ] = getField( m, 'transmission', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'transmissionMap' );
			floatArray[ index ++ ] = getField( m, 'emissiveIntensity', 0.0 );

			// emission
			if ( 'emissive' in m ) {

				floatArray[ index ++ ] = m.emissive.r;
				floatArray[ index ++ ] = m.emissive.g;
				floatArray[ index ++ ] = m.emissive.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			floatArray[ index ++ ] = getTexture( m, 'emissiveMap' );

			// normals
			floatArray[ index ++ ] = getTexture( m, 'normalMap' );
			if ( 'normalScale' in m ) {

				floatArray[ index ++ ] = m.normalScale.x;
				floatArray[ index ++ ] = m.normalScale.y;

 			} else {

 				floatArray[ index ++ ] = 1;
 				floatArray[ index ++ ] = 1;

 			}

			index ++;

			// side & matte
			floatArray[ index ++ ] = m.opacity;
			floatArray[ index ++ ] = m.alphaTest;
			index ++; // side
			index ++; // matte

			index ++; // shadow
			index ++;
			index ++;
			index ++;

			//initialize to identity
			let elementsInRowOrder = new Matrix3().transpose().elements;

			if ( m.map ) {

				// console.log( m.map );
				m.map.matrix.transposeIntoArray( elementsInRowOrder );


			}

			//first row
			floatArray[ index ++ ] = elementsInRowOrder[ 0 ];
			floatArray[ index ++ ] = elementsInRowOrder[ 1 ];
			floatArray[ index ++ ] = elementsInRowOrder[ 2 ];
			index ++;
			//second row
			floatArray[ index ++ ] = elementsInRowOrder[ 3 ];
			floatArray[ index ++ ] = elementsInRowOrder[ 4 ];
			floatArray[ index ++ ] = elementsInRowOrder[ 5 ];
			index ++;

		}

		this.needsUpdate = true;

	}

}

const prevColor = new Color();
class RenderTarget2DArray extends WebGLArrayRenderTarget {

	constructor( ...args ) {

		super( ...args );

		const tex = this.texture;
		tex.format = RGBAFormat;
		tex.type = UnsignedByteType;
		tex.minFilter = LinearFilter;
		tex.magFilter = LinearFilter;
		tex.wrapS = RepeatWrapping;
		tex.wrapT = RepeatWrapping;
		tex.setTextures = ( ...args ) => {

			this.setTextures( ...args );

		};

		const fsQuad = new FullScreenQuad( new MeshBasicMaterial() );
		this.fsQuad = fsQuad;

	}

	setTextures( renderer, width, height, textures ) {

		// save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevToneMapping = renderer.toneMapping;
		const prevAlpha = renderer.getClearAlpha();
		renderer.getClearColor( prevColor );

		// resize the render target and ensure we don't have an empty texture
		const depth = textures.length || 1;
		this.setSize( width, height, depth );
		renderer.setClearColor( 0, 0 );
		renderer.toneMapping = NoToneMapping;

		// render each texture into each layer of the target
		const fsQuad = this.fsQuad;
		for ( let i = 0, l = depth; i < l; i ++ ) {

			const texture = textures[ i ];
			//save texture uv transform
			texture.updateMatrix();
			const uvTranform = texture.matrix;
			texture.matrixAutoUpdate = false;
			texture.matrix = new Matrix3();

			fsQuad.material.map = texture;
			fsQuad.material.transparent = true;

			renderer.setRenderTarget( this, i );
			fsQuad.render( renderer );

			//restore uv tranform
			texture.matrix = uvTranform;
			texture.matrixAutoUpdate = true;

		}

		// reset the renderer
		fsQuad.material.map = null;
		renderer.setClearColor( prevColor, prevAlpha );
		renderer.setRenderTarget( prevRenderTarget );
		renderer.toneMapping = prevToneMapping;

	}

	dispose() {

		super.dispose();
		this.fsQuad.dispose();

	}

}

function binarySearchFindClosestIndexOf( array, targetValue, offset = 0, count = array.length ) {

	let lower = 0;
	let upper = count;
	while ( lower < upper ) {

		const mid = ~ ~ ( 0.5 * upper + 0.5 * lower );


		// check if the middle array value is above or below the target and shift
		// which half of the array we're looking at
		if ( array[ offset + mid ] < targetValue ) {

			lower = mid + 1;

		} else {

			upper = mid;

		}

	}

	return lower;

}

function colorToLuminance( r, g, b ) {

	// https://en.wikipedia.org/wiki/Relative_luminance
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;

}

// ensures the data is all floating point values and flipY is false
function preprocessEnvMap( envMap ) {

	const map = envMap.clone();
	map.source = new Source( { ...map.image } );
	const { width, height, data } = map.image;

	// TODO: is there a simple way to avoid cloning and adjusting the env map data here?
	// convert the data from half float uint 16 arrays to float arrays for cdf computation
	let newData = data;
	if ( map.type === HalfFloatType ) {

		newData = new Float32Array( data.length );
		for ( const i in data ) {

			newData[ i ] = DataUtils.fromHalfFloat( data[ i ] );

		}

		map.image.data = newData;
		map.type = FloatType;

	}

	// remove any y flipping for cdf computation
	if ( map.flipY ) {

		const ogData = newData;
		newData = newData.slice();
		for ( let y = 0; y < height; y ++ ) {

			for ( let x = 0; x < width; x ++ ) {

				const newY = height - y - 1;
				const ogIndex = 4 * ( y * width + x );
				const newIndex = 4 * ( newY * width + x );

				newData[ newIndex + 0 ] = ogData[ ogIndex + 0 ];
				newData[ newIndex + 1 ] = ogData[ ogIndex + 1 ];
				newData[ newIndex + 2 ] = ogData[ ogIndex + 2 ];
				newData[ newIndex + 3 ] = ogData[ ogIndex + 3 ];

			}

		}

		map.flipY = false;
		map.image.data = newData;

	}

	return map;

}

class EquirectHdrInfoUniform {

	constructor() {

		// Stores a map of [0, 1] value -> cumulative importance row & pdf
		// used to sampling a random value to a relevant row to sample from
		const marginalWeights = new DataTexture();
		marginalWeights.type = FloatType;
		marginalWeights.format = RedFormat;
		marginalWeights.minFilter = LinearFilter;
		marginalWeights.magFilter = LinearFilter;
		marginalWeights.generateMipmaps = false;

		// Stores a map of [0, 1] value -> cumulative importance column & pdf
		// used to sampling a random value to a relevant pixel to sample from
		const conditionalWeights = new DataTexture();
		conditionalWeights.type = FloatType;
		conditionalWeights.format = RedFormat;
		conditionalWeights.minFilter = LinearFilter;
		conditionalWeights.magFilter = LinearFilter;
		conditionalWeights.generateMipmaps = false;

		// store the total sum in a 1x1 tex since some android mobile devices have issues
		// storing large values in structs.
		const totalSumTex = new DataTexture();
		totalSumTex.type = FloatType;
		totalSumTex.format = RedFormat;
		totalSumTex.minFilter = LinearFilter;
		totalSumTex.magFilter = LinearFilter;
		totalSumTex.generateMipmaps = false;

		this.marginalWeights = marginalWeights;
		this.conditionalWeights = conditionalWeights;
		this.totalSum = totalSumTex;
		this.map = null;

	}

	dispose() {

		this.marginalWeights.dispose();
		this.conditionalWeights.dispose();
		this.totalSum.dispose();
		if ( this.map ) this.map.dispose();

	}

	updateFrom( hdr ) {

		// https://github.com/knightcrawler25/GLSL-PathTracer/blob/3c6fd9b6b3da47cd50c527eeb45845eef06c55c3/src/loaders/hdrloader.cpp
		// https://pbr-book.org/3ed-2018/Light_Transport_I_Surface_Reflection/Sampling_Light_Sources#InfiniteAreaLights
		const map = preprocessEnvMap( hdr );
		map.wrapS = RepeatWrapping;
		map.wrapT = RepeatWrapping;

		const { width, height, data } = map.image;

		// "conditional" = "pixel relative to row pixels sum"
		// "marginal" = "row relative to row sum"

		// track the importance of any given pixel in the image by tracking its weight relative to other pixels in the image
		const pdfConditional = new Float32Array( width * height );
		const cdfConditional = new Float32Array( width * height );

		const pdfMarginal = new Float32Array( height );
		const cdfMarginal = new Float32Array( height );

		let totalSumValue = 0.0;
		let cumulativeWeightMarginal = 0.0;
		for ( let y = 0; y < height; y ++ ) {

			let cumulativeRowWeight = 0.0;
			for ( let x = 0; x < width; x ++ ) {

				const i = y * width + x;
				const r = data[ 4 * i + 0 ];
				const g = data[ 4 * i + 1 ];
				const b = data[ 4 * i + 2 ];

				// the probability of the pixel being selected in this row is the
				// scale of the luminance relative to the rest of the pixels.
				// TODO: this should also account for the solid angle of the pixel when sampling
				const weight = colorToLuminance( r, g, b );
				cumulativeRowWeight += weight;
				totalSumValue += weight;

				pdfConditional[ i ] = weight;
				cdfConditional[ i ] = cumulativeRowWeight;

			}

			// can happen if the row is all black
			if ( cumulativeRowWeight !== 0 ) {

				// scale the pdf and cdf to [0.0, 1.0]
				for ( let i = y * width, l = y * width + width; i < l; i ++ ) {

					pdfConditional[ i ] /= cumulativeRowWeight;
					cdfConditional[ i ] /= cumulativeRowWeight;

				}

			}

			cumulativeWeightMarginal += cumulativeRowWeight;

			// compute the marginal pdf and cdf along the height of the map.
			pdfMarginal[ y ] = cumulativeRowWeight;
			cdfMarginal[ y ] = cumulativeWeightMarginal;

		}

		// can happen if the texture is all black
		if ( cumulativeWeightMarginal !== 0 ) {

			// scale the marginal pdf and cdf to [0.0, 1.0]
			for ( let i = 0, l = pdfMarginal.length; i < l; i ++ ) {

				pdfMarginal[ i ] /= cumulativeWeightMarginal;
				cdfMarginal[ i ] /= cumulativeWeightMarginal;

			}

		}

		// compute a sorted index of distributions and the probabilities along them for both
		// the marginal and conditional data. These will be used to sample with a random number
		// to retrieve a uv value to sample in the environment map.
		// These values continually increase so it's okay to interpolate between them.
		const marginalDataArray = new Float32Array( height );
		const conditionalDataArray = new Float32Array( width * height );

		for ( let i = 0; i < height; i ++ ) {

			const dist = ( i + 1 ) / height;
			const row = binarySearchFindClosestIndexOf( cdfMarginal, dist );

			marginalDataArray[ i ] = row / height;

		}

		for ( let y = 0; y < height; y ++ ) {

			for ( let x = 0; x < width; x ++ ) {

				const i = y * width + x;
				const dist = ( x + 1 ) / width;
				const col = binarySearchFindClosestIndexOf( cdfConditional, dist, y * width, width );

				conditionalDataArray[ i ] = col / width;

			}

		}

		this.dispose();

		const { marginalWeights, conditionalWeights, totalSum } = this;
		marginalWeights.image = { width: height, height: 1, data: marginalDataArray };
		marginalWeights.needsUpdate = true;

		conditionalWeights.image = { width, height, data: conditionalDataArray };
		conditionalWeights.needsUpdate = true;

		totalSum.image = { width: 1, height: 1, data: new Float32Array( [ totalSumValue ] ) };
		totalSum.needsUpdate = true;

		this.map = map;

	}

}

class PhysicalCameraUniform {

	constructor() {

		this.bokehSize = 0;
		this.apertureBlades = 0;
		this.apertureRotation = 0;
		this.focusDistance = 10;
		this.anamorphicRatio = 1;

	}

	updateFrom( camera ) {

		if ( camera instanceof PhysicalCamera ) {

			this.bokehSize = camera.bokehSize;
			this.apertureBlades = camera.apertureBlades;
			this.apertureRotation = camera.apertureRotation;
			this.focusDistance = camera.focusDistance;
			this.anamorphicRatio = camera.anamorphicRatio;

		} else {

			this.bokehSize = 0;
			this.apertureRotation = 0;
			this.apertureBlades = 0;
			this.focusDistance = 10;
			this.anamorphicRatio = 1;

		}

	}

}

const shaderUtils = /* glsl */`

	// https://google.github.io/filament/Filament.md.html#materialsystem/diffusebrdf
	float schlickFresnel( float cosine, float f0 ) {

		return f0 + ( 1.0 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

	// https://raytracing.github.io/books/RayTracingInOneWeekend.html#dielectrics/schlickapproximation
	float schlickFresnelFromIor( float cosine, float iorRatio ) {

		// Schlick approximation
		float r_0 = pow( ( 1.0 - iorRatio ) / ( 1.0 + iorRatio ), 2.0 );
		return schlickFresnel( cosine, r_0 );

	}

	// forms a basis with the normal vector as Z
	mat3 getBasisFromNormal( vec3 normal ) {

		vec3 other;
		if ( abs( normal.x ) > 0.5 ) {

			other = vec3( 0.0, 1.0, 0.0 );

		} else {

			other = vec3( 1.0, 0.0, 0.0 );

		}

		vec3 ortho = normalize( cross( normal, other ) );
		vec3 ortho2 = normalize( cross( normal, ortho ) );
		return mat3( ortho2, ortho, normal );

	}

	vec3 getHalfVector( vec3 a, vec3 b ) {

		return normalize( a + b );

	}

	// The discrepancy between interpolated surface normal and geometry normal can cause issues when a ray
	// is cast that is on the top side of the geometry normal plane but below the surface normal plane. If
	// we find a ray like that we ignore it to avoid artifacts.
	// This function returns if the direction is on the same side of both planes.
	bool isDirectionValid( vec3 direction, vec3 surfaceNormal, vec3 geometryNormal ) {

		bool aboveSurfaceNormal = dot( direction, surfaceNormal ) > 0.0;
		bool aboveGeometryNormal = dot( direction, geometryNormal ) > 0.0;
		return aboveSurfaceNormal == aboveGeometryNormal;

	}

	vec3 getHemisphereSample( vec3 n, vec2 uv ) {

		// https://www.rorydriscoll.com/2009/01/07/better-sampling/
		// https://graphics.pixar.com/library/OrthonormalB/paper.pdf
		float sign = n.z == 0.0 ? 1.0 : sign( n.z );
		float a = - 1.0 / ( sign + n.z );
		float b = n.x * n.y * a;
		vec3 b1 = vec3( 1.0 + sign * n.x * n.x * a, sign * b, - sign * n.x );
		vec3 b2 = vec3( b, sign + n.y * n.y * a, - n.y );

		float r = sqrt( uv.x );
		float theta = 2.0 * PI * uv.y;
		float x = r * cos( theta );
		float y = r * sin( theta );
		return x * b1 + y * b2 + sqrt( 1.0 - uv.x ) * n;

	}

	// https://www.shadertoy.com/view/wltcRS
	uvec4 s0;

	void rng_initialize(vec2 p, int frame) {

		// white noise seed
		s0 = uvec4( p, uint( frame ), uint( p.x ) + uint( p.y ) );

	}

	// https://www.pcg-random.org/
	void pcg4d( inout uvec4 v ) {

		v = v * 1664525u + 1013904223u;
		v.x += v.y * v.w;
		v.y += v.z * v.x;
		v.z += v.x * v.y;
		v.w += v.y * v.z;
		v = v ^ ( v >> 16u );
		v.x += v.y*v.w;
		v.y += v.z*v.x;
		v.z += v.x*v.y;
		v.w += v.y*v.z;

	}

	// returns [ 0, 1 ]
	float rand() {

		pcg4d(s0);
		return float( s0.x ) / float( 0xffffffffu );

	}

	vec2 rand2() {

		pcg4d( s0 );
		return vec2( s0.xy ) / float(0xffffffffu);

	}

	vec3 rand3() {

		pcg4d(s0);
		return vec3( s0.xyz ) / float( 0xffffffffu );

	}

	vec4 rand4() {

		pcg4d(s0);
		return vec4(s0)/float(0xffffffffu);

	}

	// https://github.com/mrdoob/three.js/blob/dev/src/math/Vector3.js#L724
	vec3 randDirection() {

		vec2 r = rand2();
		float u = ( r.x - 0.5 ) * 2.0;
		float t = r.y * PI * 2.0;
		float f = sqrt( 1.0 - u * u );

		return vec3( f * cos( t ), f * sin( t ), u );

	}

	vec2 triangleSample( vec2 a, vec2 b, vec2 c ) {

		// get the edges of the triangle and the diagonal across the
		// center of the parallelogram
		vec2 e1 = a - b;
		vec2 e2 = c - b;
		vec2 diag = normalize( e1 + e2 );

		// pick a random point in the parallelogram
		vec2 r = rand2();
		if ( r.x + r.y > 1.0 ) {

			r = vec2( 1.0 ) - r;

		}

		return e1 * r.x + e2 * r.y;

	}

	// samples an aperture shape with the given number of sides. 0 means circle
	vec2 sampleAperture( int blades ) {

		if ( blades == 0 ) {

			vec2 r = rand2();
			float angle = 2.0 * PI * r.x;
			float radius = sqrt( rand() );
			return vec2( cos( angle ), sin( angle ) ) * radius;

		} else {

			blades = max( blades, 3 );

			vec3 r = rand3();
			float anglePerSegment = 2.0 * PI / float( blades );
			float segment = floor( float( blades ) * r.x );

			float angle1 = anglePerSegment * segment;
			float angle2 = angle1 + anglePerSegment;
			vec2 a = vec2( sin( angle1 ), cos( angle1 ) );
			vec2 b = vec2( 0.0, 0.0 );
			vec2 c = vec2( sin( angle2 ), cos( angle2 ) );

			return triangleSample( a, b, c );

		}

	}

	float colorToLuminance( vec3 color ) {

		// https://en.wikipedia.org/wiki/Relative_luminance
		return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

	}

	// ray sampling x and z are swapped to align with expected background view
	vec2 equirectDirectionToUv( vec3 direction ) {

		// from Spherical.setFromCartesianCoords
		vec2 uv = vec2( atan( direction.z, direction.x ), acos( direction.y ) );
		uv /= vec2( 2.0 * PI, PI );

		// apply adjustments to get values in range [0, 1] and y right side up
		uv.x += 0.5;
		uv.y = 1.0 - uv.y;
		return uv;

	}

	vec3 equirectUvToDirection( vec2 uv ) {

		// undo above adjustments
		uv.x -= 0.5;
		uv.y = 1.0 - uv.y;

		// from Vector3.setFromSphericalCoords
		float theta = uv.x * 2.0 * PI;
		float phi = uv.y * PI;

		float sinPhi = sin( phi );

		return vec3( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

	}
`;

class PMREMCopyMaterial extends MaterialBase {

	constructor() {

		super( {

			uniforms: {

				envMap: { value: null },
				blur: { value: 0 },

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}

			`,

			fragmentShader: /* glsl */`

				#include <common>
				#include <cube_uv_reflection_fragment>

				${ shaderUtils }

				uniform sampler2D envMap;
				uniform float blur;
				varying vec2 vUv;
				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					gl_FragColor = textureCubeUV( envMap, rayDirection, blur );

				}

			`,

		} );

	}

}

class BlurredEnvMapGenerator {

	constructor( renderer ) {

		this.renderer = renderer;
		this.pmremGenerator = new PMREMGenerator( renderer );
		this.copyQuad = new FullScreenQuad( new PMREMCopyMaterial() );
		this.renderTarget = new WebGLRenderTarget( 1, 1, { type: FloatType, format: RGBAFormat } );

	}

	dispose() {

		this.pmremGenerator.dispose();
		this.copyQuad.dispose();
		this.renderTarget.dispose();

	}

	generate( texture, blur ) {

		const { pmremGenerator, renderTarget, copyQuad, renderer } = this;

		// get the pmrem target
		const pmremTarget = pmremGenerator.fromEquirectangular( texture );

		// set up the material
		const { width, height } = texture.image;
		renderTarget.setSize( width, height );
		copyQuad.material.envMap = pmremTarget.texture;
		copyQuad.material.blur = blur;

		// render
		const prevRenderTarget = renderer.getRenderTarget();
		const prevClear = renderer.autoClear;

		renderer.setRenderTarget( renderTarget );
		renderer.autoClear = true;
		copyQuad.render( renderer );

		renderer.setRenderTarget( prevRenderTarget );
		renderer.autoClear = prevClear;

		// read the data back
		const buffer = new Float32Array( width * height * 4 );
		renderer.readRenderTargetPixels( renderTarget, 0, 0, width, height, buffer );

		const result = new DataTexture( buffer, width, height, RGBAFormat, FloatType );
		result.minFilter = texture.minFilter;
		result.magFilter = texture.magFilter;
		result.wrapS = texture.wrapS;
		result.wrapT = texture.wrapT;
		result.mapping = EquirectangularReflectionMapping;
		result.needsUpdate = true;

		return result;

	}

}

const shaderMaterialStructs = /* glsl */ `

	struct PhysicalCamera {

		float focusDistance;
		float anamorphicRatio;
		float bokehSize;
		int apertureBlades;
		float apertureRotation;

	};

	struct EquirectHdrInfo {

		sampler2D marginalWeights;
		sampler2D conditionalWeights;
		sampler2D map;
		sampler2D totalSum;

	};

	struct Material {

		vec3 color;
		int map;

		float metalness;
		int metalnessMap;

		float roughness;
		int roughnessMap;

		float ior;
		float transmission;
		int transmissionMap;

		float emissiveIntensity;
		vec3 emissive;
		int emissiveMap;

		int normalMap;
		vec2 normalScale;

		bool castShadow;
		float opacity;
		float alphaTest;

		float side;
		bool matte;

		mat3 matTransform;

	};

	Material readMaterialInfo( sampler2D tex, uint index ) {

		uint i = index * 9u;

		vec4 s0 = texelFetch1D( tex, i + 0u );
		vec4 s1 = texelFetch1D( tex, i + 1u );
		vec4 s2 = texelFetch1D( tex, i + 2u );
		vec4 s3 = texelFetch1D( tex, i + 3u );
		vec4 s4 = texelFetch1D( tex, i + 4u );
		vec4 s5 = texelFetch1D( tex, i + 5u );
		vec4 s6 = texelFetch1D( tex, i + 6u );
		vec4 s7 = texelFetch1D( tex, i + 7u );
		vec4 s8 = texelFetch1D( tex, i + 8u );


		Material m;
		m.color = s0.rgb;
		m.map = int( round( s0.a ) );

		m.metalness = s1.r;
		m.metalnessMap = int( round( s1.g ) );
		m.roughness = s1.b;
		m.roughnessMap = int( round( s1.a ) );

		m.ior = s2.r;
		m.transmission = s2.g;
		m.transmissionMap = int( round( s2.b ) );
		m.emissiveIntensity = s2.a;

		m.emissive = s3.rgb;
		m.emissiveMap = int( round( s3.a ) );

		m.normalMap = int( round( s4.r ) );
		m.normalScale = s4.gb;

		m.opacity = s5.r;
		m.alphaTest = s5.g;
		m.side = s5.b;
		m.matte = bool( s5.a );

		m.castShadow = ! bool( s6.r );

		m.matTransform[0] = vec3(s7.r, s8.r, 0.0);
		m.matTransform[1] = vec3(s7.g, s8.g, 0.0);
		m.matTransform[2] = vec3(s7.b, s8.b, 1.0);

		return m;

	}

`;

const shaderGGXFunctions = /* glsl */`
// The GGX functions provide sampling and distribution information for normals as output so
// in order to get probability of scatter direction the half vector must be computed and provided.
// [0] https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf
// [1] https://hal.archives-ouvertes.fr/hal-01509746/document
// [2] http://jcgt.org/published/0007/04/01/
// [4] http://jcgt.org/published/0003/02/03/

// trowbridge-reitz === GGX === GTR

vec3 ggxDirection( vec3 incidentDir, float roughnessX, float roughnessY, float random1, float random2 ) {

	// TODO: try GGXVNDF implementation from reference [2], here. Needs to update ggxDistribution
	// function below, as well

	// Implementation from reference [1]
	// stretch view
	vec3 V = normalize( vec3( roughnessX * incidentDir.x, roughnessY * incidentDir.y, incidentDir.z ) );

	// orthonormal basis
	vec3 T1 = ( V.z < 0.9999 ) ? normalize( cross( V, vec3( 0.0, 0.0, 1.0 ) ) ) : vec3( 1.0, 0.0, 0.0 );
	vec3 T2 = cross( T1, V );

	// sample point with polar coordinates (r, phi)
	float a = 1.0 / ( 1.0 + V.z );
	float r = sqrt( random1 );
	float phi = ( random2 < a ) ? random2 / a * PI : PI + ( random2 - a ) / ( 1.0 - a ) * PI;
	float P1 = r * cos( phi );
	float P2 = r * sin( phi ) * ( ( random2 < a ) ? 1.0 : V.z );

	// compute normal
	vec3 N = P1 * T1 + P2 * T2 + V * sqrt( max( 0.0, 1.0 - P1 * P1 - P2 * P2 ) );

	// unstretch
	N = normalize( vec3( roughnessX * N.x, roughnessY * N.y, max( 0.0, N.z ) ) );

	return N;

}

// Below are PDF and related functions for use in a Monte Carlo path tracer
// as specified in Appendix B of the following paper
// See equation (2) from reference [2]
float ggxLamda( float theta, float roughness ) {

	float tanTheta = tan( theta );
	float tanTheta2 = tanTheta * tanTheta;
	float alpha2 = roughness * roughness;

	float numerator = - 1.0 + sqrt( 1.0 + alpha2 * tanTheta2 );
	return numerator / 2.0;

}

// See equation (2) from reference [2]
float ggxShadowMaskG1( float theta, float roughness ) {

	return 1.0 / ( 1.0 + ggxLamda( theta, roughness ) );

}

// See equation (125) from reference [4]
float ggxShadowMaskG2( vec3 wi, vec3 wo, float roughness ) {

	float incidentTheta = acos( wi.z );
	float scatterTheta = acos( wo.z );
	return 1.0 / ( 1.0 + ggxLamda( incidentTheta, roughness ) + ggxLamda( scatterTheta, roughness ) );

}

float ggxDistribution( vec3 halfVector, float roughness ) {

	// See equation (33) from reference [0]
	float a2 = roughness * roughness;
	float cosTheta = halfVector.z;
	float cosTheta4 = pow( cosTheta, 4.0 );

	if ( cosTheta == 0.0 ) return 0.0;

	float theta = acos( halfVector.z );
	float tanTheta = tan( theta );
	float tanTheta2 = pow( tanTheta, 2.0 );

	float denom = PI * cosTheta4 * pow( a2 + tanTheta2, 2.0 );
	return a2 / denom;

	// See equation (1) from reference [2]
	// const { x, y, z } = halfVector;
	// const a2 = roughness * roughness;
	// const mult = x * x / a2 + y * y / a2 + z * z;
	// const mult2 = mult * mult;

	// return 1.0 / Math.PI * a2 * mult2;

}

// See equation (3) from reference [2]
float ggxPDF( vec3 wi, vec3 halfVector, float roughness ) {

	float incidentTheta = acos( wi.z );
	float D = ggxDistribution( halfVector, roughness );
	float G1 = ggxShadowMaskG1( incidentTheta, roughness );

	return D * G1 * max( 0.0, dot( wi, halfVector ) ) / wi.z;

}
`;

const shaderMaterialSampling = /* glsl */`

struct SurfaceRec {
	vec3 normal;
	vec3 faceNormal;
	bool frontFace;
	float roughness;
	float filteredRoughness;
	float metalness;
	vec3 color;
	vec3 emission;
	float transmission;
	float ior;
};

struct SampleRec {
	float specularPdf;
	float pdf;
	vec3 direction;
	vec3 color;
};

${ shaderGGXFunctions }

// diffuse
float diffusePDF( vec3 wo, vec3 wi, SurfaceRec surf ) {

	// https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html#lightscattering/thescatteringpdf
	float cosValue = wi.z;
	return cosValue / PI;

}

vec3 diffuseDirection( vec3 wo, SurfaceRec surf ) {

	vec3 lightDirection = randDirection();
	lightDirection.z += 1.0;
	lightDirection = normalize( lightDirection );

	return lightDirection;

}

vec3 diffuseColor( vec3 wo, vec3 wi, SurfaceRec surf ) {

	// TODO: scale by 1 - F here
	// note on division by PI
	// https://seblagarde.wordpress.com/2012/01/08/pi-or-not-to-pi-in-game-lighting-equation/
	float metalFactor = ( 1.0 - surf.metalness ) * wi.z / ( PI * PI );
	float transmissionFactor = 1.0 - surf.transmission;
	return surf.color * metalFactor * transmissionFactor;

}

// specular
float specularPDF( vec3 wo, vec3 wi, SurfaceRec surf ) {

	// See equation (17) in http://jcgt.org/published/0003/02/03/
	float filteredRoughness = surf.filteredRoughness;
	vec3 halfVector = getHalfVector( wi, wo );
	return ggxPDF( wi, halfVector, filteredRoughness ) / ( 4.0 * dot( wi, halfVector ) );

}

vec3 specularDirection( vec3 wo, SurfaceRec surf ) {

	// sample ggx vndf distribution which gives a new normal
	float filteredRoughness = surf.filteredRoughness;
	vec3 halfVector = ggxDirection(
		wo,
		filteredRoughness,
		filteredRoughness,
		rand(),
		rand()
	);

	// apply to new ray by reflecting off the new normal
	return - reflect( wo, halfVector );

}

vec3 specularColor( vec3 wo, vec3 wi, SurfaceRec surf ) {

	// if roughness is set to 0 then D === NaN which results in black pixels
	float metalness = surf.metalness;
	float ior = surf.ior;
	bool frontFace = surf.frontFace;
	float filteredRoughness = surf.filteredRoughness;

	vec3 halfVector = getHalfVector( wo, wi );
	float iorRatio = frontFace ? 1.0 / ior : ior;
	float G = ggxShadowMaskG2( wi, wo, filteredRoughness );
	float D = ggxDistribution( halfVector, filteredRoughness );

	float F = schlickFresnelFromIor( dot( wi, halfVector ), iorRatio );
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	bool cannotRefract = iorRatio * sinTheta > 1.0;
	if ( cannotRefract ) {

		F = 1.0;

	}

	vec3 color = mix( vec3( 1.0 ), surf.color, metalness );
	color = mix( color, vec3( 1.0 ), F );
	color *= G * D / ( 4.0 * abs( wi.z * wo.z ) );
	color *= mix( F, 1.0, metalness );
	color *= wi.z; // scale the light by the direction the light is coming in from

	return color;

}

/*
// transmission
function transmissionPDF( wo, wi, material, surf ) {

	// See section 4.2 in https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? ior : 1 / ior;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	halfVector.set( 0, 0, 0 ).addScaledVector( wi, ratio ).addScaledVector( wo, 1.0 ).normalize().multiplyScalar( - 1 );

	const denom = Math.pow( ratio * halfVector.dot( wi ) + 1.0 * halfVector.dot( wo ), 2.0 );
	return ggxPDF( wo, halfVector, minRoughness ) / denom;

}

function transmissionDirection( wo, hit, material, lightDirection ) {

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? 1 / ior : ior;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	// sample ggx vndf distribution which gives a new normal
	ggxDirection(
		wo,
		minRoughness,
		minRoughness,
		Math.random(),
		Math.random(),
		halfVector,
	);

	// apply to new ray by reflecting off the new normal
	tempDir.copy( wo ).multiplyScalar( - 1 );
	refract( tempDir, halfVector, ratio, lightDirection );

}

function transmissionColor( wo, wi, material, hit, colorTarget ) {

	const { metalness, transmission } = material;
	colorTarget
		.copy( material.color )
		.multiplyScalar( ( 1.0 - metalness ) * wo.z )
		.multiplyScalar( transmission );

}
*/

// TODO: This is just using a basic cosine-weighted specular distribution with an
// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
float transmissionPDF( vec3 wo, vec3 wi, SurfaceRec surf ) {

	float ior = surf.ior;
	bool frontFace = surf.frontFace;

	float ratio = frontFace ? 1.0 / ior : ior;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, ratio );
	bool cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		return 0.0;

	}

	return 1.0 / ( 1.0 - reflectance );

}

vec3 transmissionDirection( vec3 wo, SurfaceRec surf ) {

	float roughness = surf.roughness;
	float ior = surf.ior;
	bool frontFace = surf.frontFace;
	float ratio = frontFace ? 1.0 / ior : ior;

	vec3 lightDirection = refract( - wo, vec3( 0.0, 0.0, 1.0 ), ratio );
	lightDirection += randDirection() * roughness;
	return normalize( lightDirection );

}

vec3 transmissionColor( vec3 wo, vec3 wi, SurfaceRec surf ) {

	float metalness = surf.metalness;
	float transmission = surf.transmission;

	vec3 color = surf.color;
	color *= ( 1.0 - metalness );
	color *= transmission;

	return color;

}

float bsdfPdf( vec3 wo, vec3 wi, SurfaceRec surf, out float specularPdf ) {

	float ior = surf.ior;
	float metalness = surf.metalness;
	float transmission = surf.transmission;
	bool frontFace = surf.frontFace;

	float ratio = frontFace ? 1.0 / ior : ior;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, ratio );
	bool cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1.0;

	}

	float spdf = 0.0;
	float dpdf = 0.0;
	float tpdf = 0.0;

	if ( wi.z < 0.0 ) {

		tpdf = transmissionPDF( wo, wi, surf );

	} else {

		spdf = specularPDF( wo, wi, surf );
		dpdf = diffusePDF( wo, wi, surf );

	}

	float transSpecularProb = mix( reflectance, 1.0, metalness );
	float diffSpecularProb = 0.5 + 0.5 * metalness;
	float pdf =
		spdf * transmission * transSpecularProb
		+ tpdf * transmission * ( 1.0 - transSpecularProb )
		+ spdf * ( 1.0 - transmission ) * diffSpecularProb
		+ dpdf * ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb );

	// retrieve specular rays for the shadows flag
	specularPdf = spdf * transmission * transSpecularProb + spdf * ( 1.0 - transmission ) * diffSpecularProb;

	return pdf;

}

vec3 bsdfColor( vec3 wo, vec3 wi, SurfaceRec surf ) {

	vec3 color = vec3( 0.0 );
	if ( wi.z < 0.0 ) {

		color = transmissionColor( wo, wi, surf );

	} else {

		color = diffuseColor( wo, wi, surf );
		color *= 1.0 - surf.transmission;

		color += specularColor( wo, wi, surf );

	}

	return color;

}

float bsdfResult( vec3 wo, vec3 wi, SurfaceRec surf, out vec3 color ) {

	float specularPdf;
	color = bsdfColor( wo, wi, surf );
	return bsdfPdf( wo, wi, surf, specularPdf );

}

SampleRec bsdfSample( vec3 wo, SurfaceRec surf ) {

	float ior = surf.ior;
	float metalness = surf.metalness;
	float transmission = surf.transmission;
	bool frontFace = surf.frontFace;

	float ratio = frontFace ? 1.0 / ior : ior;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, ratio );
	bool cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1.0;

	}

	SampleRec result;
	if ( rand() < transmission ) {

		float specularProb = mix( reflectance, 1.0, metalness );
		if ( rand() < specularProb ) {

			result.direction = specularDirection( wo, surf );

		} else {

			result.direction = transmissionDirection( wo, surf );

		}

	} else {

		float specularProb = 0.5 + 0.5 * metalness;
		if ( rand() < specularProb ) {

			result.direction = specularDirection( wo, surf );

		} else {

			result.direction = diffuseDirection( wo, surf );

		}

	}

	result.pdf = bsdfPdf( wo, result.direction, surf, result.specularPdf );
	result.color = bsdfColor( wo, result.direction, surf );
	return result;

}
`;

const shaderEnvMapSampling = /* glsl */`

vec3 sampleEquirectEnvMapColor( vec3 direction, sampler2D map ) {

	return texture2D( map, equirectDirectionToUv( direction ) ).rgb;

}

float envMapDirectionPdf( vec3 direction ) {

	vec2 uv = equirectDirectionToUv( direction );
	float theta = uv.y * PI;
	float sinTheta = sin( theta );
	if ( sinTheta == 0.0 ) {

		return 0.0;

	}

	return 1.0 / ( 2.0 * PI * PI * sinTheta );

}

float envMapSample( vec3 direction, EquirectHdrInfo info, out vec3 color ) {

	vec2 uv = equirectDirectionToUv( direction );
	color = texture2D( info.map, uv ).rgb;

	float totalSum = texture2D( info.totalSum, vec2( 0.0 ) ).r;
	float lum = colorToLuminance( color );
	ivec2 resolution = textureSize( info.map, 0 );
	float pdf = lum / totalSum;

	return float( resolution.x * resolution.y ) * pdf * envMapDirectionPdf( direction );

}

float randomEnvMapSample( EquirectHdrInfo info, out vec3 color, out vec3 direction ) {

	// sample env map cdf
	vec2 r = rand2();
	float v = texture2D( info.marginalWeights, vec2( r.x, 0.0 ) ).x;
	float u = texture2D( info.conditionalWeights, vec2( r.y, v ) ).x;
	vec2 uv = vec2( u, v );

	vec3 derivedDirection = equirectUvToDirection( uv );
	direction = derivedDirection;
	color = texture2D( info.map, uv ).rgb;

	float totalSum = texture2D( info.totalSum, vec2( 0.0 ) ).r;
	float lum = colorToLuminance( color );
	ivec2 resolution = textureSize( info.map, 0 );
	float pdf = lum / totalSum;

	return float( resolution.x * resolution.y ) * pdf * envMapDirectionPdf( direction );

}

float misHeuristic( float a, float b ) {

	float aa = a * a;
	float bb = a * b;
	return aa / ( bb + aa );

}

`;

class PhysicalPathTracingMaterial extends MaterialBase {

	onBeforeRender() {

		this.setDefine( 'FEATURE_DOF', this.physicalCamera.bokehSize === 0 ? 0 : 1 );

	}

	constructor( parameters ) {

		super( {

			transparent: true,
			depthWrite: false,

			defines: {
				FEATURE_MIS: 1,
				FEATURE_DOF: 1,
				FEATURE_GRADIENT_BG: 0,
				TRANSPARENT_TRAVERSALS: 5,
			},

			uniforms: {
				resolution: { value: new Vector2() },

				bounces: { value: 3 },
				physicalCamera: { value: new PhysicalCameraUniform() },

				bvh: { value: new MeshBVHUniformStruct() },
				normalAttribute: { value: new FloatVertexAttributeTexture() },
				tangentAttribute: { value: new FloatVertexAttributeTexture() },
				uvAttribute: { value: new FloatVertexAttributeTexture() },
				materialIndexAttribute: { value: new UIntVertexAttributeTexture() },
				materials: { value: new MaterialsTexture() },
				textures: { value: new RenderTarget2DArray().texture },
				cameraWorldMatrix: { value: new Matrix4() },
				invProjectionMatrix: { value: new Matrix4() },
				backgroundBlur: { value: 0.0 },
				environmentIntensity: { value: 2.0 },
				environmentRotation: { value: new Matrix3() },
				envMapInfo: { value: new EquirectHdrInfoUniform() },

				seed: { value: 0 },
				opacity: { value: 1 },
				filterGlossyFactor: { value: 0.0 },

				bgGradientTop: { value: new Color( 0x111111 ) },
				bgGradientBottom: { value: new Color( 0x000000 ) },
				backgroundAlpha: { value: 1.0 },
			},

			vertexShader: /* glsl */`

				varying vec2 vUv;
				void main() {

					vec4 mvPosition = vec4( position, 1.0 );
					mvPosition = modelViewMatrix * mvPosition;
					gl_Position = projectionMatrix * mvPosition;

					vUv = uv;

				}

			`,

			fragmentShader: /* glsl */`
				#define RAY_OFFSET 1e-4

				precision highp isampler2D;
				precision highp usampler2D;
				precision highp sampler2DArray;
				vec4 envMapTexelToLinear( vec4 a ) { return a; }
				#include <common>

				${ shaderStructs }
				${ shaderIntersectFunction }
				${ shaderMaterialStructs }

				${ shaderUtils }
				${ shaderMaterialSampling }
				${ shaderEnvMapSampling }

				uniform mat3 environmentRotation;
				uniform float backgroundBlur;
				uniform float backgroundAlpha;

				#if FEATURE_GRADIENT_BG

				uniform vec3 bgGradientTop;
				uniform vec3 bgGradientBottom;

				#endif

				#if FEATURE_DOF

				uniform PhysicalCamera physicalCamera;

				#endif

				uniform vec2 resolution;
				uniform int bounces;
				uniform mat4 cameraWorldMatrix;
				uniform mat4 invProjectionMatrix;
				uniform sampler2D normalAttribute;
				uniform sampler2D tangentAttribute;
				uniform sampler2D uvAttribute;
				uniform usampler2D materialIndexAttribute;
				uniform BVH bvh;
				uniform float environmentIntensity;
				uniform float filterGlossyFactor;
				uniform int seed;
				uniform float opacity;
				uniform sampler2D materials;

				uniform EquirectHdrInfo envMapInfo;

				uniform sampler2DArray textures;
				varying vec2 vUv;

				vec3 sampleBackground( vec3 direction ) {

					#if FEATURE_GRADIENT_BG

					direction = normalize( direction + randDirection() * 0.05 );

					float value = ( direction.y + 1.0 ) / 2.0;
					value = pow( value, 2.0 );

					return mix( bgGradientBottom, bgGradientTop, value );

					#else

					vec3 sampleDir = normalize( direction + getHemisphereSample( direction, rand2() ) * 0.5 * backgroundBlur );
					return environmentIntensity * sampleEquirectEnvMapColor( sampleDir, envMapInfo.map );

					#endif

				}

				// step through multiple surface hits and accumulate color attenuation based on transmissive surfaces
				bool attenuateHit( BVH bvh, vec3 rayOrigin, vec3 rayDirection, int traversals, bool isShadowRay, out vec3 color ) {

					// hit results
					uvec4 faceIndices = uvec4( 0u );
					vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
					vec3 barycoord = vec3( 0.0 );
					float side = 1.0;
					float dist = 0.0;

					color = vec3( 1.0 );

					for ( int i = 0; i < traversals; i ++ ) {

						if ( bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

							// TODO: attenuate the contribution based on the PDF of the resulting ray including refraction values
							// Should be able to work using the material BSDF functions which will take into account specularity, etc.
							// TODO: should we account for emissive surfaces here?

							vec2 uv = textureSampleBarycoord( uvAttribute, barycoord, faceIndices.xyz ).xy;
							uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
							Material material = readMaterialInfo( materials, materialIndex );

							// adjust the ray to the new surface
							bool isBelowSurface = dot( rayDirection, faceNormal ) < 0.0;
							vec3 point = rayOrigin + rayDirection * dist;
							vec3 absPoint = abs( point );
							float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
							rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * ( isBelowSurface ? - RAY_OFFSET : RAY_OFFSET );

							if ( ! material.castShadow && isShadowRay ) {

								continue;

							}

							// Opacity Test

							// albedo
							vec4 albedo = vec4( material.color, material.opacity );
							if ( material.map != - 1 ) {

								albedo *= texture2D( textures, vec3( material.matTranform * uv, material.map ) );

							}

							// transmission
							float transmission = material.transmission;
							if ( material.transmissionMap != - 1 ) {

								transmission *= texture2D( textures, vec3( uv, material.transmissionMap ) ).r;

							}

							// metalness
							float metalness = material.metalness;
							if ( material.metalnessMap != - 1 ) {

								metalness *= texture2D( textures, vec3( uv, material.metalnessMap ) ).b;

							}

							float alphaTest = material.alphaTest;
							bool useAlphaTest = alphaTest != 0.0;
							float transmissionFactor = ( 1.0 - metalness ) * transmission;
							if (
								transmissionFactor < rand() && ! (
									// material sidedness
									material.side != 0.0 && side == material.side

									// alpha test
									|| useAlphaTest && albedo.a < alphaTest

									// opacity
									|| ! useAlphaTest && albedo.a < rand()
								)
							) {

								return true;

							}

							// only attenuate on the way in
							if ( isBelowSurface ) {

								color *= albedo.rgb;

							}

						} else {

							return false;

						}

					}

					return true;

				}

				// returns whether the ray hit anything, not just the first surface. Could be optimized to not check the full hierarchy.
				bool anyHit( BVH bvh, vec3 rayOrigin, vec3 rayDirection ) {

					uvec4 faceIndices = uvec4( 0u );
					vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
					vec3 barycoord = vec3( 0.0 );
					float side = 1.0;
					float dist = 0.0;
					return bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );

				}

				// tentFilter from Peter Shirley's 'Realistic Ray Tracing (2nd Edition)' book, pg. 60
				// erichlof/THREE.js-PathTracing-Renderer/
				float tentFilter( float x ) {

					return x < 0.5 ? sqrt( 2.0 * x ) - 1.0 : 1.0 - sqrt( 2.0 - ( 2.0 * x ) );

				}

				void main() {

					rng_initialize( gl_FragCoord.xy, seed );

					// get [-1, 1] normalized device coordinates
					vec2 ndc = 2.0 * vUv - vec2( 1.0 );
					vec3 rayOrigin, rayDirection;
					ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix, rayOrigin, rayDirection );

					// Jitter the camera ray by finding a new subpixel point to point to from the camera origin
					// This is better than just jittering the camera position since it actually results in divergent
					// rays providing better coverage for the pixel
					{

						// TODO: the complexity here could be improved
						vec3 cameraOrigin = ( cameraWorldMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
						vec3 ss00, ss01, ss10, temp;
						ndcToCameraRay( vec2( - 1.0, - 1.0 ), cameraWorldMatrix, invProjectionMatrix, ss00, temp );
						ndcToCameraRay( vec2( - 1.0, 1.0 ), cameraWorldMatrix, invProjectionMatrix, ss01, temp );
						ndcToCameraRay( vec2( 1.0, - 1.0 ), cameraWorldMatrix, invProjectionMatrix, ss10, temp );

						vec3 ssdX = ( ss10 - ss00 ) / resolution.x;
						vec3 ssdY = ( ss01 - ss00 ) / resolution.y;
						rayOrigin += tentFilter( rand() ) * ssdX + tentFilter( rand() ) * ssdY;
						rayDirection = normalize( rayOrigin - cameraOrigin );

					}

					#if FEATURE_DOF
					{

						// depth of field
						vec3 focalPoint = rayOrigin + normalize( rayDirection ) * physicalCamera.focusDistance;

						// get the aperture sample
						vec2 apertureSample = sampleAperture( physicalCamera.apertureBlades ) * physicalCamera.bokehSize * 0.5 * 1e-3;

						// rotate the aperture shape
						float ac = cos( physicalCamera.apertureRotation );
						float as = sin( physicalCamera.apertureRotation );
						apertureSample = vec2(
							apertureSample.x * ac - apertureSample.y * as,
							apertureSample.x * as + apertureSample.y * ac
						);
						apertureSample.x *= saturate( physicalCamera.anamorphicRatio );
						apertureSample.y *= saturate( 1.0 / physicalCamera.anamorphicRatio );

						// create the new ray
						rayOrigin += ( cameraWorldMatrix * vec4( apertureSample, 0.0, 0.0 ) ).xyz;
						rayDirection = focalPoint - rayOrigin;

					}
					#endif
					rayDirection = normalize( rayDirection );

					// inverse environment rotation
					mat3 invEnvironmentRotation = inverse( environmentRotation );

					// final color
					gl_FragColor = vec4( 0.0 );
					gl_FragColor.a = 1.0;

					// hit results
					uvec4 faceIndices = uvec4( 0u );
					vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
					vec3 barycoord = vec3( 0.0 );
					float side = 1.0;
					float dist = 0.0;

					// path tracing state
					float accumulatedRoughness = 0.0;
					bool transmissiveRay = true;
					int transparentTraversals = TRANSPARENT_TRAVERSALS;
					vec3 throughputColor = vec3( 1.0 );
					SampleRec sampleRec;
					int i;
					bool isShadowRay = false;

					for ( i = 0; i < bounces; i ++ ) {

						if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

							if ( i == 0 || transmissiveRay ) {

								gl_FragColor.rgb += sampleBackground( environmentRotation * rayDirection ) * throughputColor;
								gl_FragColor.a = backgroundAlpha;

							} else {

								#if FEATURE_MIS

								// get the PDF of the hit envmap point
								vec3 envColor;
								float envPdf = envMapSample( environmentRotation * rayDirection, envMapInfo, envColor );

								// and weight the contribution
								float misWeight = misHeuristic( sampleRec.pdf, envPdf );
								gl_FragColor.rgb += environmentIntensity * envColor * throughputColor * misWeight;

								#else

								gl_FragColor.rgb +=
									environmentIntensity *
									sampleEquirectEnvMapColor( environmentRotation * rayDirection, envMapInfo.map ) *
									throughputColor;

								#endif

							}
							break;

						}

						uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
						Material material = readMaterialInfo( materials, materialIndex );

						if ( material.matte && i == 0 ) {

							gl_FragColor = vec4( 0.0 );
							break;

						}

						// if we've determined that this is a shadow ray and we've hit an item with no shadow casting
						// then skip it
						if ( ! material.castShadow && isShadowRay ) {

							vec3 point = rayOrigin + rayDirection * dist;
							vec3 absPoint = abs( point );
							float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
							rayOrigin = point - ( maxPoint + 1.0 ) * faceNormal * RAY_OFFSET;

							continue;

						}

						vec2 uv = textureSampleBarycoord( uvAttribute, barycoord, faceIndices.xyz ).xy;

						// albedo
						vec4 albedo = vec4( material.color, material.opacity );
						if ( material.map != - 1 ) {

							albedo *= texture2D( textures, vec3( uv, material.map ) );

						}

						// possibly skip this sample if it's transparent, alpha test is enabled, or we hit the wrong material side
						// and it's single sided.
						// - alpha test is disabled when it === 0
						// - the material sidedness test is complicated because we want light to pass through the back side but still
						// be able to see the front side. This boolean checks if the side we hit is the front side on the first ray
						// and we're rendering the other then we skip it. Do the opposite on subsequent bounces to get incoming light.
						float alphaTest = material.alphaTest;
						bool useAlphaTest = alphaTest != 0.0;
						bool isFirstHit = i == 0;
						if (
							// material sidedness
							material.side != 0.0 && ( side != material.side ) == isFirstHit

							// alpha test
							|| useAlphaTest && albedo.a < alphaTest

							// opacity
							|| ! useAlphaTest && albedo.a < rand()
						) {

							vec3 point = rayOrigin + rayDirection * dist;
							vec3 absPoint = abs( point );
							float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
							rayOrigin = point - ( maxPoint + 1.0 ) * faceNormal * RAY_OFFSET;

							// only allow a limited number of transparency discards otherwise we could
							// crash the context with too long a loop.
							i -= sign( transparentTraversals );
							transparentTraversals -= sign( transparentTraversals );
							continue;

						}

						// fetch the interpolated smooth normal
						vec3 normal = normalize( textureSampleBarycoord(
							normalAttribute,
							barycoord,
							faceIndices.xyz
						).xyz );

						// roughness
						float roughness = material.roughness;
						if ( material.roughnessMap != - 1 ) {

							roughness *= texture2D( textures, vec3( uv, material.roughnessMap ) ).g;

						}

						// metalness
						float metalness = material.metalness;
						if ( material.metalnessMap != - 1 ) {

							metalness *= texture2D( textures, vec3( uv, material.metalnessMap ) ).b;

						}

						// emission
						vec3 emission = material.emissiveIntensity * material.emissive;
						if ( material.emissiveMap != - 1 ) {

							emission *= texture2D( textures, vec3( uv, material.emissiveMap ) ).xyz;

						}

						// transmission
						float transmission = material.transmission;
						if ( material.transmissionMap != - 1 ) {

							transmission *= texture2D( textures, vec3( uv, material.transmissionMap ) ).r;

						}

						// normal
						if ( material.normalMap != - 1 ) {

							vec4 tangentSample = textureSampleBarycoord(
								tangentAttribute,
								barycoord,
								faceIndices.xyz
							);

							// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
							// resulting in NaNs and slow path tracing.
							if ( length( tangentSample.xyz ) > 0.0 ) {

								vec3 tangent = normalize( tangentSample.xyz );
								vec3 bitangent = normalize( cross( normal, tangent ) * tangentSample.w );
								mat3 vTBN = mat3( tangent, bitangent, normal );

								vec3 texNormal = texture2D( textures, vec3( uv, material.normalMap ) ).xyz * 2.0 - 1.0;
								texNormal.xy *= material.normalScale;
								normal = vTBN * texNormal;

							}

						}

						normal *= side;

						SurfaceRec surfaceRec;
						surfaceRec.normal = normal;
						surfaceRec.faceNormal = faceNormal;
						surfaceRec.transmission = transmission;
						surfaceRec.ior = material.ior;
						surfaceRec.emission = emission;
						surfaceRec.metalness = metalness;
						surfaceRec.color = albedo.rgb;
						surfaceRec.roughness = roughness;

						// frontFace is used to determine transmissive properties and PDF. If no transmission is used
						// then we can just always assume this is a front face.
						surfaceRec.frontFace = side == 1.0 || transmission == 0.0;

						// Compute the filtered roughness value to use during specular reflection computations. A minimum
						// value of 1e-6 is needed because the GGX functions do not work with a roughness value of 0 and
						// the accumulated roughness value is scaled by a user setting and a "magic value" of 5.0.
						// If we're exiting something transmissive then scale the factor down significantly so we can retain
						// sharp internal reflections
						surfaceRec.filteredRoughness = clamp(
							max( surfaceRec.roughness, accumulatedRoughness * filterGlossyFactor * 5.0 ),
							1e-3,
							1.0
						);

						mat3 normalBasis = getBasisFromNormal( surfaceRec.normal );
						mat3 invBasis = inverse( normalBasis );

						vec3 outgoing = - normalize( invBasis * rayDirection );
						sampleRec = bsdfSample( outgoing, surfaceRec );

						float specRayPdf = specularPDF( outgoing, sampleRec.direction, surfaceRec );
						isShadowRay = sampleRec.specularPdf < rand();

						// adjust the hit point by the surface normal by a factor of some offset and the
						// maximum component-wise value of the current point to accommodate floating point
						// error as values increase.
						vec3 point = rayOrigin + rayDirection * dist;
						vec3 absPoint = abs( point );
						float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
						rayDirection = normalize( normalBasis * sampleRec.direction );

						bool isBelowSurface = dot( rayDirection, faceNormal ) < 0.0;
						rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * ( isBelowSurface ? - RAY_OFFSET : RAY_OFFSET );

						// direct env map sampling
						#if FEATURE_MIS
						{

							// find a sample in the environment map to include in the contribution
							vec3 envColor, envDirection;
							float envPdf = randomEnvMapSample( envMapInfo, envColor, envDirection );
							envDirection = invEnvironmentRotation * envDirection;

							// this env sampling is not set up for transmissive sampling and yields overly bright
							// results so we ignore the sample in this case.
							// TODO: this should be improved but how? The env samples could traverse a few layers?
							bool isSampleBelowSurface = dot( faceNormal, envDirection ) < 0.0;
							if ( isSampleBelowSurface ) {

								envPdf = 0.0;

							}

							// check if a ray could even reach the surface
							vec3 attenuatedColor;
							if (
								envPdf > 0.0 &&
								isDirectionValid( envDirection, normal, faceNormal ) &&
								! attenuateHit( bvh, rayOrigin, envDirection, bounces - i, isShadowRay, attenuatedColor )
							) {

								// get the material pdf
								vec3 sampleColor;
								float envMaterialPdf = bsdfResult( outgoing, normalize( invBasis * envDirection ), surfaceRec, sampleColor );
								if ( envMaterialPdf > 0.0 ) {

									// weight the direct light contribution
									float misWeight = misHeuristic( envPdf, envMaterialPdf );
									gl_FragColor.rgb += attenuatedColor * environmentIntensity * envColor * throughputColor * sampleColor * misWeight / envPdf;

								}

							}

						}
						#endif

						// accumulate a roughness value to offset diffuse, specular, diffuse rays that have high contribution
						// to a single pixel resulting in fireflies
						if ( ! isBelowSurface ) {

							// determine if this is a rough normal or not by checking how far off straight up it is
							vec3 halfVector = normalize( outgoing + sampleRec.direction );
							accumulatedRoughness += sin( acos( halfVector.z ) );
							transmissiveRay = false;

						}

						// accumulate color
						gl_FragColor.rgb += ( emission * throughputColor );

						// skip the sample if our PDF or ray is impossible
						if ( sampleRec.pdf <= 0.0 || ! isDirectionValid( rayDirection, normal, faceNormal) ) {

							break;

						}

						throughputColor *= sampleRec.color / sampleRec.pdf;

						// discard the sample if there are any NaNs
						if ( any( isnan( throughputColor ) ) || any( isinf( throughputColor ) ) ) {

							break;

						}

					}

					gl_FragColor.a *= opacity;

				}

			`

		} );

		this.setValues( parameters );

	}

}

// core

export { BlurredEnvMapGenerator, DynamicPathTracingSceneGenerator, EquirectHdrInfoUniform, MaterialBase, MaterialReducer, MaterialsTexture, PathTracingRenderer, PathTracingSceneGenerator, PhysicalCamera, PhysicalCameraUniform, PhysicalPathTracingMaterial, RenderTarget2DArray, getGroupMaterialIndicesAttribute, mergeMeshes, setCommonAttributes, shaderMaterialSampling, shaderMaterialStructs, shaderUtils, trimToAttributes };
//# sourceMappingURL=index.module.js.map
