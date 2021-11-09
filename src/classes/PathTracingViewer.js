import { Scene, WebGLRenderer, MeshBasicMaterial, Vector2, Mesh, PerspectiveCamera, sRGBEncoding } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/pass.js';
import { SAH } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import { PathTracingRenderer } from '../utils/PathTracingRenderer.js';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';
import { LambertPathTracingMaterial } from '../materials/LambertPathTracingMaterial.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

export class PathTracingViewer {

	constructor() {

		this.scene = new Scene();
		this.camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
		this.camera.position.set( 1, 1, 1 );

		this.renderer = new WebGLRenderer();
		this.fsQuad = new FullScreenQuad( new MeshBasicMaterial() );
		this.ptRenderer = new PathTracingRenderer( this.renderer );
		this.ptModel = null;
		this.ptMaterials = null;
		this.model = null;
		this.bvhGenerator = new GenerateMeshBVHWorker();
		this._scale = 1;
		this._nextObject = null;
		this._needsSizeUpdate = false;
		this._newSize = new Vector2();
		this._resizeObserver = new ResizeObserver( entries => {

			const { contentRect } = entries[ 0 ];
			this._newSize.set( contentRect.width, contentRect.height );
			this._needsSizeUpdate = true;

		} );

		this._stats = new Stats();
		document.body.appendChild( this._stats.dom );

		this.ptRenderer.camera = this.camera;
		this.ptRenderer.material = new LambertPathTracingMaterial( { transparent: true, depthWrite: false } );
		this.renderer.outputEncoding = sRGBEncoding;
		this._resizeObserver.observe( this.renderer.domElement );
		this._updateSize();

	}

	_updateSize() {

		const dpr = window.devicePixelRatio;
		const scale = this._scale;
		const size = this._newSize;
		this.renderer.setPixelRatio( scale * dpr );

		this.renderer.setSize( size.width, size.height, false );
		this.ptRenderer.target.setSize( size.width * scale * dpr, size.height * scale * dpr );
		this.camera.aspect = size.width / size.height;
		this.camera.updateProjectionMatrix();
		this._needsSizeUpdate = false;

	}

	setScale( scale ) {

		this._scale = scale;
		this._needsSizeUpdate = true;

	}

	setModel( object ) {

		if ( this.bvhGenerator.running ) {

			this._nextObject = object;
			return;

		}

		object.updateMatrixWorld( true );

		const meshes = [];
		object.traverse( c => {

			if ( c.isMesh ) {

				meshes.push( c );

			}

		} );

		const { geometry, materials } = mergeMeshes( meshes, { attributes: [ 'position', 'normal', 'uv' ] } );
		return this
			.bvhGenerator
			.generate( geometry, { strategy: SAH, maxLeafTris: 1 } )
			.then( bvh => {

				if ( this._nextObject ) {

					this.setModel( this._nextObject );
					this._nextObject = null;
					return;

				}

				if ( this.model ) {

					this.scene.remove( this.model );

				}

				const mesh = new Mesh( geometry );
				this.scene.add( object );
				this.ptModel = mesh;
				this.ptMaterials = materials;
				this.model = object;

				const { ptRenderer } = this;
				ptRenderer.material.bvh.updateFrom( bvh );
				ptRenderer.material.normalAttribute.updateFrom( geometry.attributes.normal );
				ptRenderer.material.uvAttribute.updateFrom( geometry.attributes.uv );
				ptRenderer.material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
				ptRenderer.reset();

			} );

	}

	setEnvironment( envMap ) {

		this.scene.environment = envMap;

	}

	init() {

		const { ptRenderer, renderer, fsQuad, camera } = this;

		const controls = new OrbitControls( camera, renderer.domElement );
		controls.addEventListener( 'change', () => {

			ptRenderer.reset();

		} );

		renderer.setAnimationLoop( () => {

			this._stats.update();

			if ( this._needsSizeUpdate ) {

				this._updateSize();
				this.ptRenderer.reset();

			}

			if ( this.model ) {

				camera.updateMatrixWorld();

				ptRenderer.material.setDefine( 'MATERIAL_LENGTH', this.ptMaterials.length );
				ptRenderer.material.materials.updateFrom( this.ptMaterials );
				ptRenderer.update();

				fsQuad.material.map = ptRenderer.target.texture;
				fsQuad.render( renderer );

			} else {

				renderer.clear();

			}

		} );

	}

}
