import { Scene, WebGLRenderer, MeshBasicMaterial, Vector2, Mesh, PerspectiveCamera, sRGBEncoding } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SAH } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import { PathTracingRenderer } from '../core/PathTracingRenderer.js';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';
import { PhysicalPathTracingMaterial } from '../materials/PhysicalPathTracingMaterial.js';
import { MaterialReducer } from '../core/MaterialReducer.js';

export class PathTracingViewer {

	get domElement() {

		return this._container;

	}

	constructor() {

		this.scene = new Scene();
		this.camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
		this.camera.position.set( - 1, 0.25, 1 );

		this.renderer = new WebGLRenderer( { antialias: true } );
		this.fsQuad = new FullScreenQuad( new MeshBasicMaterial( { transparent: true } ) );
		this.ptRenderer = new PathTracingRenderer( this.renderer );
		this.ptModel = null;
		this.ptMaterials = null;
		this.ptTextures = null;
		this.model = null;
		this.bvhGenerator = new GenerateMeshBVHWorker();
		this.onRender = null;
		this.enablePathTracing = true;
		this.pausePathTracing = false;
		this.samplesPerFrame = 1;
		this._scale = 1;
		this._nextObject = null;
		this._needsSizeUpdate = false;
		this._newSize = new Vector2();
		this._resizeObserver = new ResizeObserver( entries => {

			const { contentRect } = entries[ 0 ];
			this._newSize.set( contentRect.width, contentRect.height );
			this._needsSizeUpdate = true;

		} );

		const container = document.createElement( 'div' );
		container.style.overflow = 'hidden';
		container.appendChild( this.renderer.domElement );
		this._container = container;

		this.ptRenderer.camera = this.camera;
		this.ptRenderer.material = new PhysicalPathTracingMaterial();
		this.renderer.outputEncoding = sRGBEncoding;
		this._resizeObserver.observe( container );

	}

	_updateSize() {

		const dpr = window.devicePixelRatio;
		const scale = this._scale;
		const size = this._newSize;
		this.renderer.setPixelRatio( dpr );

		this.renderer.domElement.style.aspectRatio = `${ size.width } / ${ size.height }`;
		this.renderer.domElement.style.width = `100%`;
		this.renderer.setSize( scale * size.width, scale * size.height, false );
		this.ptRenderer.target.setSize( size.width * scale * dpr, size.height * scale * dpr );
		this.camera.aspect = size.width / size.height;
		this.camera.updateProjectionMatrix();
		this._needsSizeUpdate = false;

	}

	setScale( scale ) {

		this._scale = scale;
		this._needsSizeUpdate = true;

	}

	setModel( object, bvhOptions = {} ) {

		if ( this.bvhGenerator.running ) {

			this._nextObject = object;
			return;

		}

		object.updateMatrixWorld( true );

		const materialReducer = new MaterialReducer();
		materialReducer.process( object );

		const meshes = [];
		object.traverse( c => {

			if ( c.isMesh ) {

				meshes.push( c );

			}

		} );

		const { geometry, materials, textures } = mergeMeshes( meshes, { attributes: [ 'position', 'normal', 'tangent', 'uv' ] } );
		return this
			.bvhGenerator
			.generate( geometry, { strategy: SAH, maxLeafTris: 1, ...bvhOptions } )
			.then( bvh => {

				if ( this._nextObject ) {

					this.setModel( this._nextObject );
					this._nextObject = null;
					return;

				}

				if ( this.model ) {

					this.scene.remove( this.model );
					this.ptTextures.forEach( tex => tex.dispose() );
					this.ptMaterials.forEach( mat => mat.dispose() );

				}

				const mesh = new Mesh( geometry );
				this.scene.add( object );
				this.ptModel = mesh;
				this.ptMaterials = materials;
				this.ptTextures = textures;
				this.model = object;

				const { ptRenderer } = this;
				const { material } = ptRenderer;

				// dispose of textures because they cannot be updated in later version of three.js
				material.bvh.dispose();
				material.normalAttribute.dispose();
				material.tangentAttribute.dispose();
				material.uvAttribute.dispose();
				material.materialIndexAttribute.dispose();
				material.textures.dispose();

				material.bvh.updateFrom( bvh );
				material.normalAttribute.updateFrom( geometry.attributes.normal );
				material.tangentAttribute.updateFrom( geometry.attributes.tangent );
				material.uvAttribute.updateFrom( geometry.attributes.uv );
				material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
				material.textures.setTextures( this.renderer, 2048, 2048, textures );
				material.materials.updateFrom( materials, textures );
				material.setDefine( 'MATERIAL_LENGTH', materials.length );
				ptRenderer.reset();

			} );

	}

	setEnvironment( envMap ) {

		this.scene.environment = envMap;

	}

	init() {

		const { ptRenderer, renderer, fsQuad, camera } = this;

		const controls = new OrbitControls( camera, renderer.domElement );
		let delaySamples = 0;
		controls.addEventListener( 'change', () => {

			const tiles = this.ptRenderer.tiles;
			if ( tiles.x * tiles.y !== 1 ) {

				delaySamples = 1;

			}

			ptRenderer.reset();

		} );

		renderer.setAnimationLoop( () => {

			if ( this.pausePathTracing ) {

				return;

			}

			if ( this._needsSizeUpdate ) {

				this._updateSize();
				this.ptRenderer.reset();

			}

			if ( this.model ) {

				// ensure materials are updated
				const { ptRenderer, ptMaterials, ptTextures } = this;
				ptRenderer.material.materials.updateFrom( ptMaterials, ptTextures );

				if ( this.enablePathTracing && delaySamples === 0 ) {

					camera.updateMatrixWorld();

					for ( let i = 0, l = this.samplesPerFrame; i < l; i ++ ) {

						ptRenderer.update();

					}

					if ( ptRenderer.samples < 1 ) {

						renderer.render( this.scene, this.camera );

					}

					renderer.autoClear = false;
					fsQuad.material.map = ptRenderer.target.texture;
					fsQuad.render( renderer );
					renderer.autoClear = true;

				} else {

					if ( delaySamples > 0 ) {

						delaySamples --;

					}

					renderer.render( this.scene, this.camera );

				}

			} else {

				renderer.clear();

			}

			if ( this.onRender ) {

				this.onRender();

			}

		} );

	}

}
