import * as assert from 'assert'
import { List } from "immutable"
import _defaults = require('lodash/defaults')
import Bluebird from './PromiseConfig'

// const
// 	log = require('typelogger').create(__filename)

export interface IPoolOptions {
	min?:number
	max?:number,
	limit?:number
}


export enum PoolResourceStatus {
	Created,
	Ready,
	Destroyed
}


export interface IPoolResource<T> {
	resource:T
	reserved:boolean
	status:PoolResourceStatus
}

export interface IPoolResourceInternal<T> extends IPoolResource<T>{
	createDeferred:Bluebird.Resolver<T>
	destroyDeferred?:Bluebird.Resolver<T>
}

export interface IPoolResourceFactory<T> {
	create():Bluebird<T>
	destroy(resource:T): Bluebird<void>
	validate(resource:T): Bluebird<boolean>
}



export class Pool<T> {
	
	private resources = List<IPoolResourceInternal<T>>().asMutable()
	
	private killed = false
	
	private running = true
	
	constructor(private factory:IPoolResourceFactory<T>, private opts:IPoolOptions = {}) {
		_defaults(this.opts,{
			min: 0,
			max: -1,
			limit: -1
		})
		
		this.checkInventory()
	}
	
	
	/**
	 * Start the pool
	 */
	
	private checkInventory() {
		let
			{min,max,limit} = this.opts,
			activeResources = this.getActiveResources(),
			activeCount = activeResources.size,
			availableResources = this.getAvailableResources(),
			availableCount = availableResources.size,
			newCount = min < 1 || availableCount >= min ?
				0 :
				min - availableCount,
			destroyCount = max < 1 || availableCount <= max ?
				0:
				availableCount - max
		
		// CHECK THE MAX VALUES
		if (limit > 0 && newCount + activeCount > limit)
			newCount = limit - availableCount
		
		for (let i = 0; i < newCount;i++) {
			this.createResource()
		}
		
		for (let i = 0; i < destroyCount;i++) {
			this.destroy(availableResources.get(i).resource)
		}
		
		// Array
		// 	.from(Array(this.opts.min).keys())
		// 	.map(this.createResource)
		
	}
	
	/**
	 * Create a resource
	 *
	 * @returns {Promise<IPoolResource>}
	 */
	private createResource = async ():Promise<IPoolResourceInternal<T>> => {
		assert(this.running,`Pool is not running`)
		const
			poolResource = {
				resource: null,
				status: PoolResourceStatus.Created,
				reserved: false,
				createDeferred: Bluebird.defer<T>()
			} as IPoolResourceInternal<T>
		
		this.resources.push(poolResource)
		
		this.factory
			.create()
			.then(resource => {
				Object.assign(poolResource,{
					resource,
					status: PoolResourceStatus.Ready
				})
				
				poolResource.createDeferred.resolve(resource)
				return poolResource
			})
			.catch(err => {
				Object.assign(poolResource,{
					status: PoolResourceStatus.Destroyed
				})
				poolResource.createDeferred.reject(err)
			})
		
		return poolResource
			.createDeferred
			.promise
			.then(() => poolResource)
		
	}
	
	/**
	 * is running
	 *
	 * @returns {boolean}
	 */
	get isRunning() {
		return this.running && !this.killed
	}
	
	/**
	 * is shutting down
	 *
	 * @returns {boolean}
	 */
	get isShuttingDown() {
		return !this.running && !this.killed
	}
	
	/**
	 * is completely shutdown
	 *
	 * @returns {boolean}
	 */
	get isShutdown() {
		return this.killed && !this.running
	}
	
	/**
	 * Find a pooled resource record
	 *
	 * @param resource
	 * @returns {IPoolResource}
	 */
	private getPoolResource(resource:T):IPoolResource<T> {
		return this.resources.find(it => it.resource === resource)
	}
	
	/**
	 * Get all resources
	 *
	 * @returns {List<IPoolResource>}
	 */
	getResources():List<IPoolResource<T>> {
		return this.resources
	}
	
	/**
	 * Get active not destroyed resources
	 *
	 * @returns {List<IPoolResource>}
	 */
	getActiveResources():List<IPoolResource<T>> {
		return this.resources.filter(it => it.status < PoolResourceStatus.Destroyed) as any
	}
	
	/**
	 * Get available - active + not reserved instances
	 *
	 * @returns {any}
	 */
	getAvailableResources():List<IPoolResource<T>> {
		return this.getActiveResources()
			.filter(it => !it.reserved) as any
	}
	
	canCreateResource() {
		const
			{limit} = this.opts
		
		return (limit < 1 || this.getActiveResources().size < limit)
	}
	
	/**
	 * Acquire a resource
	 *
	 * @returns {Promise<any>}
	 */
	async acquire():Promise<T> {
		
		assert(this.running,`Pool is not running`)
		
		const
			resources = this.getAvailableResources() as List<IPoolResourceInternal<T>>
		
		// GET OR CREATE RESOURCE
		let
			poolResource = (resources.size) ?
				resources.get(0) :
				this.canCreateResource() ?
					(await this.createResource()) :
					null
		
		assert(poolResource,`Could not create pool resource, size=${this.resources.size} with max size=${this.opts.max}`)
		
		
		// MARK RESERVED
		poolResource.reserved = true
		
		// GET UNDERLYING RESOURCE
		let
			resource:T = poolResource.resource || (await poolResource.createDeferred.promise)
		
		// VALID BEFORE HANDING IT OUT
		if (!(await this.validate(resource))) {
			await this.destroy(resource)
			
			return this.acquire()
			
		}
		
		this.checkInventory()
		
		return poolResource.resource
		
	}
	
	/**
	 * Validate a resource is still valid
	 *
	 * @param resource
	 * @returns {boolean|Promise<boolean>}
	 */
	async validate(resource:T):Promise<boolean> {
		return !this.factory.validate || (await this.factory.validate(resource))
	}
	
	/**
	 * Release a resource
	 *
	 * @param resource
	 * @returns {Promise<void>}
	 */
	async release(resource:T):Promise<void> {
		assert(this.running,`Pool is not running`)
		
		const
			poolResource = this.getPoolResource(resource)
		
		assert(poolResource,`Unknown pool resource, can not release`)
		
		Object.assign(poolResource,{
			reserved: false
		})
		
		this.checkInventory()
	}
	
	/**
	 * Destroy a resource
	 *
	 * @param resource
	 * @returns {Promise<void>}
	 */
	async destroy(resource:T):Promise<void> {
		assert(!this.killed,`Pool is not running`)
		
		const poolResource = this.getPoolResource(resource) as IPoolResourceInternal<T>
		
		if (!poolResource)
			return
		
		Object.assign(resource,{
			reserved: true,
			status: PoolResourceStatus.Destroyed
		})
		
		
		// IF NOT ALREADY DESTROYED, START THE PROCESS
		if (!poolResource.destroyDeferred) {
			poolResource.destroyDeferred = Bluebird.defer<any>()
			
			this.factory
				.destroy(resource)
				.then(() => {
					poolResource.destroyDeferred.resolve()
					
				})
		}
		
		this.checkInventory()
	}
	
	/**
	 * Drain the pool
	 */
	async drain():Promise<void> {
		if (!this.running)
			return
		
		this.running = false
		await Promise.all(this.resources.map(it => this.destroy(it.resource)).toArray())
		this.killed = true
	}
	
}